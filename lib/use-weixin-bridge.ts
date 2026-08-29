// lib/use-weixin-bridge.ts
// React hook：管理所有 WeChat Bot 的轮询生命周期 + 后台保活。

import { useEffect, useRef, useState, useCallback } from "react";
import { loadWeixinBots, loadKeepAlive, type WeixinBotConfig } from "./weixin-storage";
import { runBotLoop } from "./weixin-bridge";

export type BotRunStatus = {
    status: "running" | "stopped" | "error";
    message?: string;
};

// ⏸ 临时总开关：暂停微信 Bot 的 getupdates 长轮询，止血 Netlify compute
//（长轮询会全程占用函数时长）。仅停轮询，不影响后台保活（保活是通用功能）。
// 恢复功能：改回 false 重新部署。长期方案=用户电脑本地助手接管轮询。
const WEIXIN_BRIDGE_PAUSED: boolean = true;

// 模块级状态：让设置页面也能读到
const _statusMap = new Map<string, BotRunStatus>();

export function getWeixinBotStatus(id: string): BotRunStatus {
    return _statusMap.get(id) ?? { status: "stopped" };
}

function broadcastStatus() {
    window.dispatchEvent(new CustomEvent("weixin-status-changed"));
}

// ── 保活：Wake Lock + 静音音频 ───────────────────────────────
let _wakeLock: WakeLockSentinel | null = null;
let _keepAliveAudio: HTMLAudioElement | null = null;
let _keepAliveAudioUrl: string | null = null;
let _keepAliveContext: AudioContext | null = null;
let _keepAliveOscillator: OscillatorNode | null = null;
let _keepAliveGain: GainNode | null = null;

let _keepAliveWanted = false; // 标记：想要保活但还没获得用户手势
let _suspendedForCall = false; // 标记：因语音/视频通话临时暂停了保活

function getKeepAliveAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!_keepAliveContext) {
        try { _keepAliveContext = new AudioContextCtor(); } catch { return null; }
    }
    return _keepAliveContext;
}

function ensureAudioCreated() {
    if (_keepAliveAudio || _keepAliveOscillator) return;

    // Web Audio 不会被 Android 当作媒体元素展示在屏幕顶部，优先用它维持后台
    // 音频豁免；仍保留 HTMLAudioElement 作为不支持 Web Audio 的设备回退。
    const ctx = getKeepAliveAudioContext();
    if (ctx) {
        try {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.type = "sine";
            oscillator.frequency.value = 20;
            gain.gain.value = 0.00003;
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            _keepAliveOscillator = oscillator;
            _keepAliveGain = gain;
            return;
        } catch {
            _keepAliveOscillator = null;
            _keepAliveGain = null;
        }
    }

    if (_keepAliveAudio) return;
    _keepAliveAudio = new Audio();
    // 生成 1 秒、48 kHz、16 bit、立体声静音 WAV。
    // 低采样率的循环音频可能让部分 Android WebView 进入窄带通信输出，
    // 影响页面内其它 TTS 的音质；这里使用常见的媒体播放规格。
    const sampleRate = 48000;
    const channels = 2;
    const bitsPerSample = 16;
    const samples = sampleRate;
    const blockAlign = channels * bitsPerSample / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples * blockAlign;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);
    // ±1 LSB 微噪声（约 -90dB，不可闻）：纯零波形会被 Chrome 判为"无声页面"，
    // 安卓后台 5 分钟后定时器被强节流（轮询延迟拉到分钟级）；左右声道都
    // 保留极低能量，以继续获得 "playing audio" 豁免。
    for (let i = 0; i < samples; i++) {
        const value = i % 2 === 0 ? 1 : -1;
        const frameOffset = 44 + i * blockAlign;
        view.setInt16(frameOffset, value, true);
        view.setInt16(frameOffset + 2, value, true);
    }
    const blob = new Blob([buf], { type: "audio/wav" });
    _keepAliveAudioUrl = URL.createObjectURL(blob);
    _keepAliveAudio.src = _keepAliveAudioUrl;
    _keepAliveAudio.loop = true;
    _keepAliveAudio.volume = 0.01;
}

/** 用户触摸时尝试播放（浏览器要求音频必须在用户手势中启动） */
function onUserGesture() {
    if (!_keepAliveWanted) return;
    const ctx = _keepAliveContext;
    if (ctx && ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
    }
    if (!_keepAliveAudio) return;
    _keepAliveAudio.play().then(() => {
        // 成功了，移除监听
        document.removeEventListener("touchstart", onUserGesture, true);
        document.removeEventListener("click", onUserGesture, true);
    }).catch(() => {});
}

async function startKeepAlive() {
    _keepAliveWanted = true;

    // Wake Lock
    try {
        if ("wakeLock" in navigator) {
            _wakeLock = await navigator.wakeLock.request("screen");
            _wakeLock.addEventListener("release", () => { _wakeLock = null; });
        }
    } catch {}

    // 准备音频
    ensureAudioCreated();

    const ctx = _keepAliveContext;
    if (_keepAliveOscillator && ctx) {
        if (ctx.state === "suspended") {
            void ctx.resume().catch(() => {
                document.addEventListener("touchstart", onUserGesture, { capture: true, once: false });
                document.addEventListener("click", onUserGesture, { capture: true, once: false });
            });
        }
        try {
            if (_keepAliveOscillator.context.state === "suspended") void _keepAliveOscillator.context.resume();
            _keepAliveOscillator.start();
        } catch { /* 已启动时忽略 */ }
        return;
    }

    // 不支持 Web Audio 时回退到循环媒体元素。
    _keepAliveAudio!.play().catch(() => {
        // 失败了：注册监听，等下一次用户触摸时播放
        document.addEventListener("touchstart", onUserGesture, { capture: true, once: false });
        document.addEventListener("click", onUserGesture, { capture: true, once: false });
    });
}

function stopKeepAlive() {
    _keepAliveWanted = false;
    _suspendedForCall = false;
    _wakeLock?.release().catch(() => {});
    _wakeLock = null;
    if (_keepAliveOscillator) {
        try { _keepAliveOscillator.stop(); } catch { /* ignore */ }
        try { _keepAliveOscillator.disconnect(); } catch { /* ignore */ }
        try { _keepAliveGain?.disconnect(); } catch { /* ignore */ }
        _keepAliveOscillator = null;
        _keepAliveGain = null;
    }
    if (_keepAliveContext) {
        try { void _keepAliveContext.suspend(); } catch { /* ignore */ }
        _keepAliveContext = null;
    }
    if (_keepAliveAudio) {
        _keepAliveAudio.pause();
        _keepAliveAudio.currentTime = 0;
        // 仅 pause() 在部分 Android WebView 中仍会保留旧的音频输出链路；
        // 彻底卸载媒体源，下一次开启时重新创建高质量保活音频。
        _keepAliveAudio.removeAttribute("src");
        _keepAliveAudio.load();
        _keepAliveAudio = null;
    }
    if (_keepAliveAudioUrl) {
        URL.revokeObjectURL(_keepAliveAudioUrl);
        _keepAliveAudioUrl = null;
    }
    document.removeEventListener("touchstart", onUserGesture, true);
    document.removeEventListener("click", onUserGesture, true);
}

/**
 * Pause keep-alive for the duration of a voice/video call. Starting STT grabs
 * the mic and the OS audio focus, which would otherwise interrupt the looping
 * silent audio and leave it dead after the call. The call holds the mic + audio
 * session itself, so keep-alive is redundant meanwhile. No-op if keep-alive is off.
 */
export function suspendKeepAliveForCall() {
    if (!_keepAliveWanted) return;
    _suspendedForCall = true;
    _wakeLock?.release().catch(() => {});
    _wakeLock = null;
    if (_keepAliveAudio) {
        try { _keepAliveAudio.pause(); } catch {}
    }
    if (_keepAliveContext) {
        try { void _keepAliveContext.suspend(); } catch {}
    }
    document.removeEventListener("touchstart", onUserGesture, true);
    document.removeEventListener("click", onUserGesture, true);
}

/** Re-arm keep-alive after a call ends, unless the user turned it off meanwhile. */
export function resumeKeepAliveAfterCall() {
    if (!_suspendedForCall) return;
    _suspendedForCall = false;
    if (!_keepAliveWanted) return; // keep-alive was switched off during the call
    void startKeepAlive(); // re-acquires Wake Lock + replays the silent audio
}

export function useWeixinBridge() {
    const [bots, setBots] = useState<WeixinBotConfig[]>([]);
    const abortMap = useRef(new Map<string, AbortController>());

    // 初始加载 + 监听配置变更
    useEffect(() => {
        setBots(loadWeixinBots());
        const handler = () => setBots(loadWeixinBots());
        window.addEventListener("weixin-config-changed", handler);
        return () => window.removeEventListener("weixin-config-changed", handler);
    }, []);

    // 启动 bot（可复用：首次 + 回前台恢复）
    const startBot = useCallback((bot: WeixinBotConfig) => {
        if (WEIXIN_BRIDGE_PAUSED) {
            _statusMap.set(bot.id, { status: "stopped", message: "已暂停（为节省额度临时关闭，稍后恢复）" });
            broadcastStatus();
            return;
        }
        if (abortMap.current.has(bot.id)) return;

        const ctrl = new AbortController();
        abortMap.current.set(bot.id, ctrl);

        _statusMap.set(bot.id, { status: "running" });
        broadcastStatus();

        runBotLoop(
            bot,
            ctrl.signal,
            (status, message) => {
                _statusMap.set(bot.id, { status, message });
                broadcastStatus();
            },
        ).finally(() => {
            abortMap.current.delete(bot.id);
            if (!_statusMap.get(bot.id)?.message) {
                _statusMap.set(bot.id, { status: "stopped" });
                broadcastStatus();
            }
        });
    }, []);

    // 同步轮询 loop
    useEffect(() => {
        const activeBots = bots.filter(b => b.enabled && b.botToken.trim());

        for (const bot of activeBots) startBot(bot);

        // 停止已禁用或已删除的 bot
        for (const [id, ctrl] of abortMap.current) {
            if (!activeBots.find(b => b.id === id)) {
                ctrl.abort();
                _statusMap.set(id, { status: "stopped" });
            }
        }
        broadcastStatus();
    }, [bots, startBot]);

    // 保活管理：只要用户开启保活就启动，不依赖 Bot 是否启用。
    useEffect(() => {
        const shouldKeepAlive = loadKeepAlive();
        if (shouldKeepAlive) {
            startKeepAlive();
        } else {
            stopKeepAlive();
        }

        // 监听保活设置变更
        const onCfg = () => {
            const on = loadKeepAlive();
            if (on) startKeepAlive(); else stopKeepAlive();
        };
        window.addEventListener("weixin-config-changed", onCfg);
        return () => {
            window.removeEventListener("weixin-config-changed", onCfg);
            stopKeepAlive();
        };
    }, []);

    // 回到前台：恢复被挂起的轮询 + 重新获取 Wake Lock
    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState !== "visible") return;

            // 重启所有已停止（非错误）的 bot
            const activeBots = loadWeixinBots().filter(b => b.enabled && b.botToken.trim());
            for (const bot of activeBots) {
                if (!abortMap.current.has(bot.id)) {
                    startBot(bot);
                }
            }

            // Wake Lock 在 visibilitychange 时会自动释放，需重新获取
            if (loadKeepAlive()) {
                startKeepAlive();
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, [startBot]);

    // 卸载时全部停止
    useEffect(() => {
        return () => {
            for (const ctrl of abortMap.current.values()) ctrl.abort();
        };
    }, []);
}
