"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, BookOpen, Trash2 } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
  createOrGetVnSession,
  startNewChapter,
  updateChapterSummary,
  loadVnMessagesForChapter,
  deleteVnChapter,
} from "@/lib/vn-storage";
import { summarizeVnChapter } from "@/lib/vn-engine";

interface VnChaptersProps {
  characterId: string;
  onClose: () => void;
  onSelect: (chapterIndex: number) => void;
  vnTheme?: string;
}

// Node positions: zigzag left/right
function getNodeX(index: number): number {
  const positions = [35, 65, 30, 70, 40, 60, 25, 75];
  return positions[index % positions.length];
}

export function VnChapters({ characterId, onClose, onSelect, vnTheme }: VnChaptersProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [, forceUpdate] = useState(0);
  const [summarizing, setSummarizing] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const character = useMemo(() => {
    return loadCharacters().find((c) => c.id === characterId);
  }, [characterId]);

  const session = useMemo(() => {
    return createOrGetVnSession(characterId);
  }, [characterId]);

  const chapters = session.chapters;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setTimeout(() => setMounted(true), 100);
  }, []);

  const lastChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;
  const canCreateNewChapter = !lastChapter || lastChapter.archived;

  const handleNewChapter = useCallback(() => {
    if (!canCreateNewChapter) return;
    const index = chapters.length;
    const title = `第${numberToChinese(index + 1)}章`;
    startNewChapter(session.id, title);
    forceUpdate((n) => n + 1);
    onSelect(index);
  }, [canCreateNewChapter, chapters.length, session.id, onSelect]);

  const handleSummarize = useCallback(async (chapterIndex: number) => {
    setSummarizing(chapterIndex);
    try {
      const messages = loadVnMessagesForChapter(session.id, chapterIndex);
      if (messages.length === 0) return;
      const summary = await summarizeVnChapter(characterId, messages);
      updateChapterSummary(session.id, chapterIndex, summary);
      forceUpdate((n) => n + 1);
    } catch (err) {
      console.error("VN chapter summarization failed:", err);
    } finally {
      setSummarizing(null);
    }
  }, [session.id, characterId]);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const beginLongPress = useCallback((chapterIndex: number) => {
    clearLongPress();
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setDeleteTarget(chapterIndex);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(35);
    }, 650);
  }, [clearLongPress]);

  const handleChapterClick = useCallback((chapterIndex: number) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    onSelect(chapterIndex);
  }, [onSelect]);

  const handleDeleteChapter = useCallback(() => {
    if (deleteTarget === null) return;
    if (deleteVnChapter(session.id, deleteTarget)) {
      setDeleteTarget(null);
      forceUpdate((n) => n + 1);
    }
  }, [deleteTarget, session.id]);

  const nodeSpacing = 120;
  const totalHeight = (chapters.length + 1) * nodeSpacing + 200;

  const buildPath = () => {
    const starOffset = 22;
    const points = chapters.map((_, i) => ({
      x: getNodeX(i),
      y: 80 + i * nodeSpacing - starOffset,
    }));
    if (points.length < 2) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    const lastY = points[points.length - 1].y + nodeSpacing;
    d += ` L 50 ${lastY}`;
    return d;
  };

  return (
    <div className="vnc-shell" data-vn-theme={vnTheme || "default"}>
      <style>{`
        .vnc-shell {
          position: absolute;
          inset: 0;
          background: var(--vn-bg);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", system-ui, sans-serif;
          -webkit-user-select: none;
          user-select: none;
        }

        /* ── Starfield ── */
        .vnc-shell::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(1.2px 1.2px at 12% 18%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 28% 42%, rgba(255,255,255,0.25), transparent),
            radial-gradient(0.8px 0.8px at 45% 8%, rgba(255,255,255,0.2), transparent),
            radial-gradient(1px 1px at 62% 55%, rgba(255,255,255,0.3), transparent),
            radial-gradient(0.6px 0.6px at 78% 22%, rgba(255,255,255,0.15), transparent),
            radial-gradient(1.2px 1.2px at 88% 68%, rgba(255,255,255,0.35), transparent),
            radial-gradient(0.8px 0.8px at 8% 75%, rgba(255,255,255,0.2), transparent),
            radial-gradient(1px 1px at 55% 88%, rgba(255,255,255,0.25), transparent),
            radial-gradient(0.6px 0.6px at 35% 65%, rgba(255,255,255,0.15), transparent),
            radial-gradient(1px 1px at 72% 38%, rgba(255,255,255,0.2), transparent),
            radial-gradient(0.8px 0.8px at 18% 92%, rgba(255,255,255,0.15), transparent),
            radial-gradient(1.5px 1.5px at 92% 12%, rgba(255,255,255,0.3), transparent),
            radial-gradient(0.6px 0.6px at 42% 32%, rgba(255,255,255,0.1), transparent),
            radial-gradient(1px 1px at 5% 48%, rgba(255,255,255,0.2), transparent),
            radial-gradient(0.8px 0.8px at 68% 82%, rgba(255,255,255,0.15), transparent);
          pointer-events: none;
          z-index: 0;
          animation: vnc-twinkle 4s ease-in-out infinite alternate;
        }
        @keyframes vnc-twinkle {
          0% { opacity: 0.7; }
          100% { opacity: 1; }
        }

        /* Nebula glow */
        .vnc-shell::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 25% 40%, rgba(100,60,180,0.07) 0%, transparent 50%),
            radial-gradient(circle at 75% 60%, rgba(60,100,200,0.05) 0%, transparent 50%),
            radial-gradient(circle at 50% 80%, rgba(140,80,160,0.04) 0%, transparent 40%);
          pointer-events: none;
          z-index: 0;
        }

        /* ── Top Bar ── */
        .vnc-topbar {
          position: relative;
          z-index: 10;
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: var(--page-header-content-height, 42px);
          margin-top: var(--page-header-safe-top, 48px);
          padding: 1px 20px;
        }
        .vnc-btn {
          width: 36px; height: 36px; border: none; background: transparent;
          color: var(--vn-control-color); display: flex; align-items: center;
          justify-content: center; cursor: pointer; transition: all 0.2s;
        }
        .vnc-btn:active { transform: scale(0.9); color: var(--vn-ui-text-bright); }
        .vnc-header-center { text-align: center; }
        .vnc-char-name {
          font-size: calc(15px*var(--app-text-scale,1)); font-weight: 500; color: var(--vn-ui-text);
          letter-spacing: 0.12em;
        }
        .vnc-char-sub {
          font-size: calc(10px*var(--app-text-scale,1)); color: var(--vn-ui-text-dim);
          letter-spacing: 0.2em; text-transform: uppercase; margin-top: 2px;
        }

        /* ── Scroll ── */
        .vnc-scroll {
          flex: 1; overflow-y: auto; overflow-x: hidden;
          position: relative; z-index: 1; scrollbar-width: none;
        }
        .vnc-scroll::-webkit-scrollbar { display: none; }

        /* ── Canvas ── */
        .vnc-canvas {
          position: relative;
          width: 100%;
        }

        /* ── SVG lines ── */
        .vnc-svg {
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          pointer-events: none;
          z-index: 1;
        }
        .vnc-path {
          fill: none;
          stroke: var(--vn-ui-accent-dim);
          stroke-width: 1;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .vnc-path-glow {
          fill: none;
          stroke: var(--vn-ui-border);
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
          filter: blur(3px);
        }

        /* ── Star Node ── */
        .vnc-node {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          z-index: 2;
          transition: all 0.3s;
        }
        .vnc-node:active { transform: translate(-50%, -50%) scale(0.93); }

        /* ── Star graphic ── */
        .vnc-star {
          width: 16px; height: 16px;
          position: relative;
          display: flex; align-items: center; justify-content: center;
        }
        .vnc-star-core {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 0 4px #fff, 0 0 8px rgba(200,180,255,0.6), 0 0 16px rgba(160,140,240,0.3);
          z-index: 3;
        }
        .vnc-star-ring {
          position: absolute;
          inset: -2px;
          border-radius: 50%;
          border: 1px solid var(--vn-ui-border);
          z-index: 2;
        }
        .vnc-star-flare {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(180,160,255,0.15) 0%, transparent 70%);
          z-index: 1;
          animation: vnc-flare 3s ease-in-out infinite alternate;
        }
        @keyframes vnc-flare {
          0% { transform: scale(0.8); opacity: 0.5; }
          100% { transform: scale(1.2); opacity: 1; }
        }
        /* Cross rays */
        .vnc-star-ray {
          position: absolute;
          background: linear-gradient(90deg, transparent, var(--vn-ui-accent-dim), transparent);
          z-index: 2;
        }
        .vnc-star-ray-h {
          width: 24px; height: 1px;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
        }
        .vnc-star-ray-v {
          width: 1px; height: 24px;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
        }

        /* Archived style */
        .vnc-node[data-archived="true"] .vnc-star-core {
          background: rgba(200,180,255,0.5);
          box-shadow: 0 0 4px rgba(200,180,255,0.3);
        }
        .vnc-node[data-archived="true"] .vnc-star-flare { opacity: 0.3; }

        /* ── Labels ── */
        .vnc-label { text-align: center; white-space: nowrap; }
        .vnc-chapter-title {
          font-size: calc(13px*var(--app-text-scale,1)); font-weight: 500;
          color: var(--vn-ui-text-bright); letter-spacing: 0.1em;
        }
        .vnc-chapter-sub {
          font-size: calc(11px*var(--app-text-scale,1)); color: var(--vn-ui-text-dim);
          letter-spacing: 0.06em; margin-top: 2px;
        }

        /* ── Action buttons ── */
        .vnc-actions {
          display: flex;
          gap: 6px;
          margin-top: 4px;
        }
        .vnc-action-btn {
          width: 28px; height: 28px; border-radius: 50%;
          border: 1px solid var(--vn-ui-border);
          background: var(--vn-ui-input);
          color: var(--vn-ui-text-dim);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s;
          font-family: inherit;
        }
        .vnc-action-btn:active {
          background: var(--vn-ui-accent-bg);
          color: var(--vn-ui-text);
        }
        .vnc-action-btn[data-loading="true"] {
          opacity: 0.4;
          pointer-events: none;
          animation: vnc-spin 1s linear infinite;
        }
        @keyframes vnc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* ── New chapter ── */
        .vnc-new {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 12px; cursor: pointer; border: none; background: transparent;
          color: var(--vn-ui-text-dim); font-family: inherit; z-index: 2;
          transition: all 0.3s;
        }
        .vnc-new:active { color: var(--vn-ui-text); transform: translate(-50%, -50%) scale(0.95); }
        .vnc-new-dot {
          width: 28px; height: 28px; border-radius: 50%;
          border: 1px dashed var(--vn-ui-border);
          display: flex; align-items: center; justify-content: center;
        }
        .vnc-new-text { font-size: calc(11px*var(--app-text-scale,1)); letter-spacing: 0.1em; }

        /* ── Summary badge ── */
        .vnc-summary-badge {
          font-size: calc(9px*var(--app-text-scale,1));
          color: rgba(160,140,240,0.6);
          letter-spacing: 0.05em;
          margin-top: 2px;
        }
        .vnc-delete-hint {
          font-size: calc(9px*var(--app-text-scale,1));
          color: var(--vn-ui-text-dim);
          opacity: 0.45;
          letter-spacing: 0.08em;
          margin-top: 3px;
        }

        /* ── Delete confirmation ── */
        .vnc-modal-backdrop {
          position: absolute; inset: 0; z-index: 30;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          background: rgba(4, 4, 12, 0.72);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .vnc-modal {
          width: min(100%, 320px);
          padding: 24px 20px 18px;
          border: 1px solid var(--vn-ui-border);
          border-radius: 18px;
          background: var(--vn-bg);
          box-shadow: 0 18px 60px rgba(0,0,0,0.45);
          text-align: center;
        }
        .vnc-modal-icon {
          width: 44px; height: 44px; margin: 0 auto 14px;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          color: #f0a0a8; background: rgba(190,70,85,0.13);
          border: 1px solid rgba(220,110,125,0.24);
        }
        .vnc-modal-title { color: var(--vn-ui-text-bright); font-size: calc(16px*var(--app-text-scale,1)); }
        .vnc-modal-copy {
          margin-top: 10px; color: var(--vn-ui-text-dim);
          font-size: calc(12px*var(--app-text-scale,1)); line-height: 1.7;
        }
        .vnc-modal-actions { display: flex; gap: 10px; margin-top: 20px; }
        .vnc-modal-btn {
          flex: 1; min-height: 42px; border-radius: 12px; cursor: pointer;
          border: 1px solid var(--vn-ui-border); color: var(--vn-ui-text);
          background: var(--vn-ui-input); font-family: inherit;
        }
        .vnc-modal-btn-danger {
          color: #ffd9dd; border-color: rgba(220,110,125,0.35);
          background: rgba(170,55,70,0.22);
        }
        .vnc-modal-btn:active { transform: scale(0.97); }
      `}</style>

      {/* ── Top Bar ── */}
      <div className="vnc-topbar">
        <button className="vnc-btn" onClick={onClose}>
          <ArrowLeft size={20} />
        </button>
        <div className="vnc-header-center">
          <div className="vnc-char-name">{character?.name ?? "角色"}</div>
          <div className="vnc-char-sub">Story Line</div>
        </div>
        <div style={{ width: 40 }} />
      </div>

      {/* ── Scrollable Star Map ── */}
      <div className="vnc-scroll" ref={scrollRef}>
        <div className="vnc-canvas" style={{ height: totalHeight }}>

          {/* SVG connecting lines */}
          {chapters.length >= 2 && (
            <svg className="vnc-svg" viewBox={`0 0 100 ${totalHeight}`} preserveAspectRatio="none">
              <path className="vnc-path-glow" d={buildPath()} vectorEffect="non-scaling-stroke" />
              <path className="vnc-path" d={buildPath()} vectorEffect="non-scaling-stroke" />
            </svg>
          )}

          {/* Chapter nodes */}
          {chapters.map((ch, i) => {
            const x = getNodeX(i);
            const y = 80 + i * nodeSpacing;
            return (
              <div
                key={ch.id}
                className="vnc-node"
                data-archived={ch.archived ? "true" : undefined}
                style={{ left: `${x}%`, top: y, opacity: mounted ? 1 : 0, transition: `all 0.5s ease ${i * 0.15}s` }}
                onClick={() => handleChapterClick(i)}
                onPointerDown={() => beginLongPress(i)}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerLeave={clearLongPress}
              >
                <div className="vnc-star">
                  <div className="vnc-star-flare" />
                  <div className="vnc-star-ring" />
                  <div className="vnc-star-ray vnc-star-ray-h" />
                  <div className="vnc-star-ray vnc-star-ray-v" />
                  <div className="vnc-star-core" />
                </div>
                <div className="vnc-label">
                  <div className="vnc-chapter-title">{ch.title}</div>
                  {ch.subtitle && <div className="vnc-chapter-sub">{ch.subtitle}</div>}
                  {ch.summaryContent && <div className="vnc-summary-badge">已生成记忆</div>}
                  <div className="vnc-delete-hint">长按删除</div>
                </div>
                {/* Summarize button for archived chapters without summary */}
                {ch.archived && !ch.summaryContent && (
                  <div className="vnc-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="vnc-action-btn"
                      title="生成全局记忆"
                      data-loading={summarizing === i ? "true" : undefined}
                      onClick={() => handleSummarize(i)}
                    >
                      <BookOpen size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* New chapter button */}
          <button
            className="vnc-new"
            style={{
              left: "50%",
              top: 80 + chapters.length * nodeSpacing,
              opacity: canCreateNewChapter ? undefined : 0.25,
              pointerEvents: canCreateNewChapter ? undefined : "none",
            }}
            onClick={handleNewChapter}
          >
            <div className="vnc-new-dot"><Plus size={14} /></div>
            <span className="vnc-new-text">{canCreateNewChapter ? "新章节" : "请先归档当前章节"}</span>
          </button>
        </div>
      </div>

      {deleteTarget !== null && chapters[deleteTarget] && (
        <div className="vnc-modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="vnc-modal" role="dialog" aria-modal="true" aria-labelledby="vnc-delete-title" onClick={(e) => e.stopPropagation()}>
            <div className="vnc-modal-icon"><Trash2 size={20} /></div>
            <div className="vnc-modal-title" id="vnc-delete-title">删除{chapters[deleteTarget].title}？</div>
            <div className="vnc-modal-copy">
              本章的全部剧情、选项、配音与章节记忆都会永久删除，后续章节将自动向前顺延。此操作无法撤销。
            </div>
            <div className="vnc-modal-actions">
              <button className="vnc-modal-btn" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="vnc-modal-btn vnc-modal-btn-danger" onClick={handleDeleteChapter}>确认删除</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function numberToChinese(n: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (n <= 10) return digits[n];
  if (n < 20) return `十${digits[n - 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}
