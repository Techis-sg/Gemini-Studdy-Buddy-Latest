import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { IconDotsVerticalFilled as MoreVertical } from "@tabler/icons-react";

export interface ActionMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface ActionMenuPortalProps {
  items: ActionMenuItem[];
  align?: "right" | "left";
}

export function ActionMenuPortal({ items, align = "right" }: ActionMenuPortalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; right?: number; left?: number; placeAbove: boolean } | null>(null);

  const updateCoords = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const menuHeight = items.length * 36 + 16;
    const placeAbove = spaceBelow < menuHeight + 20 && spaceAbove > spaceBelow;

    if (align === "right") {
      setCoords({
        top: placeAbove ? rect.top - 6 : rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
        placeAbove,
      });
    } else {
      setCoords({
        top: placeAbove ? rect.top - 6 : rect.bottom + 6,
        left: Math.max(8, rect.left),
        placeAbove,
      });
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
    } else {
      updateCoords();
      setIsOpen(true);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleScrollOrResize = () => {
      setIsOpen(false);
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-flex items-center justify-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-200 cursor-pointer flex items-center justify-center"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && coords && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
          />
          <div
            className="fixed z-[9999] w-36 bg-white border border-slate-200 shadow-2xl rounded-xl py-1.5 font-sans text-xs text-left animate-in fade-in zoom-in-95 duration-100"
            style={{
              top: `${coords.top}px`,
              ...(coords.right !== undefined ? { right: `${coords.right}px` } : {}),
              ...(coords.left !== undefined ? { left: `${coords.left}px` } : {}),
              transform: coords.placeAbove ? "translateY(-100%)" : "none",
            }}
          >
            {items.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                  item.onClick();
                }}
                className={`w-full px-3.5 py-2 flex items-center gap-2 font-bold font-mono text-[10px] uppercase cursor-pointer transition-colors ${
                  item.danger
                    ? "text-rose-600 hover:bg-rose-50"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
