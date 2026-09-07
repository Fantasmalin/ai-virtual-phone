"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Palette, Trash2, Type } from "lucide-react";
import { ContentDialog } from "@/components/ui/modal";
import { ColorInput, Select, Slider } from "@/components/ui/form";
import type { ReadingAppearance } from "@/lib/reading-appearance";
import { DEFAULT_READING_APPEARANCE, READING_FONT_OPTIONS, resolveReadingFontFamily } from "@/lib/reading-appearance";

const READING_COLORS = [
    ["橄榄绿", "#465338"], ["暖茶褐", "#51452F"],
    ["深灰", "#363A40"], ["墨蓝", "#30465B"],
    ["奶油白", "#FFF8E7"], ["柔灰", "#797E85"],
];
function parseHex(value: string): string | null {
    const text = value.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toUpperCase()}`;
    if (/^[0-9a-f]{3}$/i.test(text)) return `#${text.split("").map(c => c + c).join("").toUpperCase()}`;
    return null;
}

type Props = {
    appearance: ReadingAppearance;
    backgroundUrl: string | null;
    onClose: () => void;
    onSave: (
        appearance: ReadingAppearance,
        options: { backgroundFile: File | null; clearBackground: boolean; customFontFile: File | null; clearCustomFont: boolean }
    ) => Promise<void>;
};

export function ReadingAppearanceDialog({ appearance, backgroundUrl, onClose, onSave }: Props) {
    const [draft, setDraft] = useState<ReadingAppearance>(appearance);
    const [hexInput, setHexInput] = useState(appearance.textColor);
    const [colorError, setColorError] = useState("");
    const [previewFont, setPreviewFont] = useState<string>();
    const chooseColor = (color: string) => {
        setHexInput(color);
        setColorError("");
        setDraft(prev => ({ ...prev, textColor: color }));
    };
    const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
    const [customFontFile, setCustomFontFile] = useState<File | null>(null);
    const [clearBackground, setClearBackground] = useState(false);
    const [clearCustomFont, setClearCustomFont] = useState(false);
    const [saving, setSaving] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(backgroundUrl);
    const fileRef = useRef<HTMLInputElement>(null);
    const fontFileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setDraft(appearance);
        setHexInput(appearance.textColor);
        setColorError("");
        setBackgroundFile(null);
        setCustomFontFile(null);
        setClearBackground(false);
        setClearCustomFont(false);
        setPreviewUrl(backgroundUrl);
    }, [appearance, backgroundUrl]);

    useEffect(() => {
        if (!backgroundFile) return;
        const url = URL.createObjectURL(backgroundFile);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [backgroundFile]);

    useEffect(() => {
        if (!customFontFile) { setPreviewFont(undefined); return; }
        let cancelled = false;
        const url = URL.createObjectURL(customFontFile);
        const family = `ReadingPreview_${Date.now()}`;
        const face = new FontFace(family, `url("${url}")`);
        void face.load().then(loaded => {
            if (cancelled) return;
            document.fonts.add(loaded);
            setPreviewFont(`"${family}"`);
        }).catch(() => { if (!cancelled) setPreviewFont(undefined); });
        return () => { cancelled = true; document.fonts.delete(face); URL.revokeObjectURL(url); };
    }, [customFontFile]);

    const hasPreview = useMemo(() => Boolean(previewUrl) && !clearBackground, [previewUrl, clearBackground]);
    const fade = draft.backgroundFade ?? 0;
    const previewFamily = draft.fontFamily === "custom"
        ? (previewFont || (clearCustomFont ? "var(--app-font-family)" : "var(--reading-font-family, var(--app-font-family))"))
        : resolveReadingFontFamily(draft.fontFamily);

    const handleSave = async () => {
        const color = parseHex(hexInput);
        if (!color && hexInput !== appearance.textColor) {
            setColorError("请输入 3 位或 6 位十六进制色号，例如 #35482C");
            return;
        }
        const textColor = color || draft.textColor;
        const recentColors = [...new Set([...(color ? [color] : []), ...(draft.recentColors || [])])].slice(0, 8);
        try {
            setSaving(true);
            await onSave({ ...draft, textColor, recentColors }, { backgroundFile, clearBackground, customFontFile, clearCustomFont });
            onClose();
        } catch (err) {
            alert(err instanceof Error ? err.message : "阅读外观保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <ContentDialog
            title="阅读外观"
            confirmLabel={saving ? "保存中..." : "保存"}
            cancelLabel="取消"
            onConfirm={() => { if (!saving) void handleSave(); }}
            onCancel={() => { if (!saving) onClose(); }}
        >
            <div className="reading-settings-grid">
                <section className="reading-settings-group">
                    <div className="reading-settings-heading">
                        <Type size={15} />
                        <span>正文样式</span>
                    </div>
                    <label className="reading-settings-label">
                        <span>字体</span>
                        <Select
                            value={draft.fontFamily}
                            onChange={(e) => setDraft((prev) => ({ ...prev, fontFamily: e.target.value as ReadingAppearance["fontFamily"] }))}
                        >
                            {READING_FONT_OPTIONS.map((option) => (
                                option.id === "custom" && !draft.customFontName ? null :
                                <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                        </Select>
                    </label>
                    <div className="reading-settings-inline-note">
                        <span>自定义字体</span>
                        <span>{draft.customFontName ? `已选择 · ${draft.customFontName}` : "未上传"}</span>
                    </div>
                    <div className="reading-settings-actions">
                        <button
                            type="button"
                            className="ui-btn ui-btn-outline"
                            onClick={() => fontFileRef.current?.click()}
                            disabled={saving}
                        >
                            <Type size={14} />
                            <span>{draft.customFontName ? "更换字体" : "上传字体"}</span>
                        </button>
                        <button
                            type="button"
                            className="ui-btn ui-btn-ghost"
                            onClick={() => {
                                setCustomFontFile(null);
                                setClearCustomFont(true);
                                setDraft((prev) => ({
                                    ...prev,
                                    customFontName: undefined,
                                    fontFamily: prev.fontFamily === "custom" ? "system" : prev.fontFamily,
                                }));
                            }}
                            disabled={saving || !draft.customFontName}
                        >
                            <Trash2 size={14} />
                            <span>清除</span>
                        </button>
                    </div>
                    <input
                        ref={fontFileRef}
                        type="file"
                        accept=".ttf,.otf,.woff,.woff2"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            e.target.value = "";
                            if (!file) return;
                            setCustomFontFile(file);
                            setClearCustomFont(false);
                            setDraft((prev) => ({
                                ...prev,
                                fontFamily: "custom",
                                customFontName: file.name,
                            }));
                        }}
                    />
                    <Slider
                        label="字号"
                        min={14}
                        max={28}
                        step={1}
                        value={draft.fontSize}
                        onChange={(e) => setDraft((prev) => ({ ...prev, fontSize: Number(e.target.value) }))}
                        displayValue={`${draft.fontSize}px`}
                    />
                    <Slider
                        label="行间距"
                        min={1.4}
                        max={2.4}
                        step={0.1}
                        value={draft.lineHeight}
                        onChange={(e) => setDraft((prev) => ({ ...prev, lineHeight: Number(e.target.value) }))}
                        displayValue={draft.lineHeight.toFixed(1)}
                    />
                    <div className="reading-settings-color-row">
                        <span className="reading-settings-label-inline">文字颜色</span>
                        <ColorInput value={draft.textColor} onChange={chooseColor} />
                    </div>
                    <label className="reading-settings-label">
                        <span>文字色号（支持 #RGB / #RRGGBB）</span>
                        <input type="text" value={hexInput} spellCheck={false} autoCapitalize="off" aria-invalid={Boolean(colorError)}
                            placeholder="#35482C" disabled={saving}
                            style={{ width: "100%", minWidth: 0, padding: 12, border: "1px solid #aaa", borderRadius: 10, color: "#222", background: "#fff" }}
                            onChange={e => {
                                const value = e.target.value;
                                setHexInput(value);
                                const color = parseHex(value);
                                setColorError(color ? "" : "请输入完整的 3 位或 6 位色号");
                                if (color) setDraft(prev => ({ ...prev, textColor: color }));
                            }} />
                    </label>
                    {colorError && <p role="alert" style={{ color: "#a13228", fontSize: 13 }}>{colorError}；预览保留上一个有效颜色。</p>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                        {READING_COLORS.map(([label, color]) => (
                            <button key={color} type="button" disabled={saving} aria-pressed={draft.textColor.toUpperCase() === color}
                                onClick={() => chooseColor(color)} className="ui-btn ui-btn-outline" style={{ width: "100%", minWidth: 0, minHeight: 44, padding: "10px 6px", gap: 6, whiteSpace: "nowrap", justifyContent: "center" }}>
                                <span aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", background: color, border: "1px solid #999" }} />{label}
                            </button>
                        ))}
                    </div>
                    {(draft.recentColors || []).length > 0 && <div>
                        <p>最近保存的颜色</p>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 4, width: "100%" }}>
                            {draft.recentColors!.map(color => <button key={color} type="button" disabled={saving}
                                aria-label={`使用颜色 ${color}`} title={color} onClick={() => chooseColor(color)}
                                style={{ width: "100%", minWidth: 0, height: "auto", aspectRatio: "1", padding: 0, borderRadius: 6, background: color, border: "1px solid #aaa" }} />)}
                        </div>
                    </div>}
                    <button type="button" className="ui-btn ui-btn-outline" disabled={saving} onClick={() => {
                        chooseColor(DEFAULT_READING_APPEARANCE.textColor);
                        setDraft(prev => ({ ...prev, textColor: DEFAULT_READING_APPEARANCE.textColor, backgroundFade: 0 }));
                    }}>恢复默认配色</button>
                    <p className="reading-settings-inline-note">仅恢复正文颜色和淡化程度，不清除壁纸、字体或最近颜色。点击保存后生效。</p>
                </section>

                <section className="reading-settings-group">
                    <div className="reading-settings-heading">
                        <Palette size={15} />
                        <span>全屏背景</span>
                    </div>
                    <Slider label="阅读页壁纸淡化" min={0} max={1} step={0.05} value={fade}
                        displayValue={`${Math.round(fade * 100)}%`}
                        onChange={e => setDraft(prev => ({ ...prev, backgroundFade: Number(e.target.value) }))} />
                    <p className="reading-settings-inline-note">叠加奶油色底，书架不淡化。正文改色适用于 TXT / EPUB，不改变 PDF 原文颜色。</p>
                    <div style={{
                        borderRadius: 16, overflow: "hidden", padding: 20, maxHeight: 360, overflowY: "auto",
                        backgroundColor: "#fffced", backgroundSize: "cover", backgroundPosition: "center",
                        backgroundImage: `linear-gradient(rgba(255,252,237,${fade}),rgba(255,252,237,${fade})), ${hasPreview ? `url("${previewUrl}")` : "none"}`,
                        color: draft.textColor, fontFamily: previewFamily, fontSize: draft.fontSize, lineHeight: draft.lineHeight,
                    }} aria-label="阅读外观示例预览">
                        <strong>午后的书页</strong>
                        <p style={{ margin: "12px 0", textIndent: "2em", color: "inherit", fontSize: "inherit", lineHeight: "inherit", fontFamily: "inherit" }}>阳光落在窗边，小青蛙躲进一片绿叶的阴影里。翻开书，今天的故事才刚刚开始。</p>
                        <p style={{ margin: "12px 0", textIndent: "2em", color: "inherit", fontSize: "inherit", lineHeight: "inherit", fontFamily: "inherit" }}>慢慢读下去，让文字清晰，也让喜欢的壁纸陪在身边。</p>
                    </div>
                    <p className="reading-settings-inline-note">示例随设置实时变化；预览区域与全屏比例不同，请保存后再检查文字压在图案上的效果。</p>
                    <div className="reading-settings-actions">
                        <button
                            type="button"
                            className="ui-btn ui-btn-outline"
                            onClick={() => fileRef.current?.click()}
                            disabled={saving}
                        >
                            <ImagePlus size={14} />
                            <span>{hasPreview ? "更换背景" : "选择背景"}</span>
                        </button>
                        <button
                            type="button"
                            className="ui-btn ui-btn-ghost"
                            onClick={() => {
                                setBackgroundFile(null);
                                setClearBackground(true);
                                setPreviewUrl(null);
                            }}
                            disabled={saving || (!hasPreview && !backgroundFile)}
                        >
                            <Trash2 size={14} />
                            <span>清除</span>
                        </button>
                    </div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            e.target.value = "";
                            if (!file) return;
                            setBackgroundFile(file);
                            setClearBackground(false);
                        }}
                    />
                </section>
            </div>
        </ContentDialog>
    );
}
