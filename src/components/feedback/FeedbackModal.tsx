import React, { useState } from "react";
import { 
  IconSend, 
  IconX, 
  IconMessageReport, 
  IconCheck, 
  IconAlertCircle, 
  IconArrowLeft, 
  IconPaperclip, 
  IconBug, 
  IconTrash, 
  IconUpload 
} from "@tabler/icons-react";
import { toast } from "react-hot-toast";
import { apiFetch } from "@utils/index";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onSuccessRedirect: () => void;
}

export function FeedbackModal({ isOpen, onClose, user, onSuccessRedirect }: FeedbackModalProps) {
  const [mode, setMode] = useState<"feedback" | "issue">("feedback");
  const [name, setName] = useState(user?.name || "");
  const email = user?.email || "student@example.com";
  const [message, setMessage] = useState("");
  const [screenshots, setScreenshots] = useState<Array<{ name: string; url: string; size: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  // Validation Calculations
  const trimmedMsg = message.trim();
  const wordCount = trimmedMsg ? trimmedMsg.split(/\s+/).filter(Boolean).length : 0;
  
  // Characters and word limits based on active mode
  const maxChars = mode === "issue" ? 600 : 255;
  const maxWords = mode === "issue" ? 100 : 50;

  const isAllowedChars = message.length === 0 || /^[a-zA-Z0-9\s.,/\\?!#-]+$/.test(message);
  const isLengthValid = message.length >= 5 && message.length <= maxChars;
  const isWordCountValid = wordCount >= 2 && wordCount <= maxWords;
  const isNameValid = name.trim().length > 0;

  const isFormValid = isNameValid && isAllowedChars && isLengthValid && isWordCountValid && !submitting;

  const handleSwitchMode = (targetMode: "feedback" | "issue") => {
    setMode(targetMode);
    setMessage("");
    setScreenshots([]);
  };

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (screenshots.length + files.length > 5) {
      toast.error("You can attach a maximum of 5 screenshots.");
      return;
    }

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`"${file.name}" is not an image file.`);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds the 5MB size limit.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          const formattedSize = (file.size / 1024).toFixed(0) + " KB";
          setScreenshots((prev) => [
            ...prev,
            { name: file.name, url: result, size: formattedSize }
          ]);
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  };

  const handleRemoveScreenshot = (index: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    setSubmitting(true);
    try {
      const res = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email,
          message: message.trim(),
          type: mode,
          screenshots: screenshots.map((s) => s.url),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to submit request");
      }

      const data = await res.json();
      if (mode === "issue") {
        toast.success("Issue report submitted successfully!");
      } else {
        toast.success("Feedback submitted successfully!");
      }

      setMessage("");
      setScreenshots([]);
      onClose();
      onSuccessRedirect();
    } catch (err: any) {
      console.error("Submission error:", err);
      toast.error(err.message || "An error occurred while sending your request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div 
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50/50 via-purple-50/30 to-white">
          <div className="flex items-center gap-3">
            {mode === "issue" ? (
              <>
                <button
                  type="button"
                  onClick={() => handleSwitchMode("feedback")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/80 rounded-xl transition-all cursor-pointer shrink-0 shadow-xs"
                >
                  <IconArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <div className="w-9 h-9 rounded-2xl bg-rose-600 flex items-center justify-center text-white shadow-md shadow-rose-600/20 shrink-0">
                  <IconBug className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 tracking-tight">Report an Issue</h3>
                  <p className="text-[10px] text-slate-500 font-mono">Submit bugs or technical problems faced</p>
                </div>
              </>
            ) : (
              <>
                <div className="w-9 h-9 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/20 shrink-0">
                  <IconMessageReport className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 tracking-tight">Direct Feedback to Developer</h3>
                  <p className="text-[10px] text-slate-500 font-mono">Share thoughts, bugs, or feature suggestions</p>
                </div>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Name Field */}
          <div>
            <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-1">
              Your Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full Name"
              className="w-full text-xs font-bold px-3.5 py-2.5 border border-slate-200 hover:border-slate-300 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all text-slate-800"
            />
          </div>

          {/* Email Field (Disabled / Readonly) */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                Email Address
              </label>
              <span className="text-[9px] font-mono text-indigo-600 font-bold uppercase bg-indigo-50 px-1.5 py-0.5 rounded">
                Verified Account
              </span>
            </div>
            <input
              type="email"
              value={email}
              disabled
              readOnly
              className="w-full text-xs font-bold px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-500 cursor-not-allowed select-none font-mono"
            />
          </div>

          {/* Message Field */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                {mode === "issue" ? "Issue Description" : "Feedback Message"} <span className="text-rose-500">*</span>
              </label>
              <span className={`text-[10px] font-mono font-bold ${message.length > maxChars || wordCount > maxWords ? 'text-rose-500' : 'text-slate-400'}`}>
                {wordCount}/{maxWords} words • {message.length}/{maxChars} chars
              </span>
            </div>
            <textarea
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                mode === "issue" 
                  ? "Describe what issue you faced and steps how to reproduce it" 
                  : "Write your feedback here (min 2 words, allowed symbols: . , / \\ ? ! # -)..."
              }
              className={`w-full text-xs font-medium p-3.5 border rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 transition-all text-slate-800 ${
                !isAllowedChars || (message.length > 0 && (message.length > maxChars || wordCount > maxWords))
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/10'
                  : 'border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/10'
              }`}
            />

            {/* Validation indicators */}
            <div className="mt-2 space-y-1.5 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                {isAllowedChars ? (
                  <IconCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <IconAlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                )}
                <span className={isAllowedChars ? "text-slate-600" : "text-rose-600 font-bold"}>
                  Letters, numbers, spaces, and allowed symbols (. , / \ ? ! # -)
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {isWordCountValid ? (
                  <IconCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <IconAlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                )}
                <span className={isWordCountValid ? "text-slate-600" : "text-amber-600 font-medium"}>
                  {mode === "issue" ? `Allowed 100 words (${wordCount}/100)` : `At least 2 words required (${wordCount}/2)`}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {isLengthValid ? (
                  <IconCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <IconAlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                )}
                <span className={isLengthValid ? "text-slate-600" : "text-amber-600 font-medium"}>
                  Between 5 and {maxChars} characters ({message.length}/{maxChars})
                </span>
              </div>
            </div>

            {/* Mode Toggle Button: Blue "Report Issue Instead" in Feedback mode */}
            {mode === "feedback" && (
              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handleSwitchMode("issue")}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 underline hover:no-underline cursor-pointer flex items-center gap-1 transition-colors"
                >
                  <span>Report Issue Instead</span>
                </button>
                <span className="text-[10px] text-slate-400 font-mono">Facing bugs or technical errors?</span>
              </div>
            )}
          </div>

          {/* Screenshot Upload Section (Active in Issue mode) */}
          {mode === "issue" && (
            <div className="space-y-2 pt-1 border-t border-slate-100">
              <div className="flex justify-between items-center">
                <label className="block text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <IconPaperclip className="w-3.5 h-3.5 text-blue-600" />
                  <span>Attach Screenshots (Optional)</span>
                </label>
                <span className="text-[10px] font-mono text-slate-400">
                  {screenshots.length}/5 files
                </span>
              </div>

              {/* Upload Drop Area */}
              <label className="border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-blue-50/20 rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all group text-center">
                <IconUpload className="w-6 h-6 text-slate-400 group-hover:text-blue-600 group-hover:scale-110 transition-all mb-1" />
                <span className="text-xs font-semibold text-slate-700 group-hover:text-blue-600">
                  Click or drag screenshots to attach
                </span>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                  Supports PNG, JPG, WEBP (Max 5MB per file)
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleScreenshotUpload}
                  className="hidden"
                />
              </label>

              {/* Screenshot Preview Grid */}
              {screenshots.length > 0 && (
                <div className="grid grid-cols-3 gap-2 pt-2">
                  {screenshots.map((s, idx) => (
                    <div key={idx} className="relative group rounded-xl border border-slate-200 bg-slate-50 p-1.5 flex flex-col items-center text-center overflow-hidden">
                      <img
                        src={s.url}
                        alt={s.name}
                        className="w-full h-16 object-cover rounded-lg mb-1"
                      />
                      <span className="text-[9px] font-mono text-slate-700 font-medium truncate w-full px-1">
                        {s.name}
                      </span>
                      <span className="text-[8px] font-mono text-slate-400">
                        {s.size}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveScreenshot(idx)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-rose-600 text-white shadow-md opacity-90 hover:opacity-100 hover:scale-110 transition-all cursor-pointer"
                        title="Remove screenshot"
                      >
                        <IconX className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!isFormValid}
              className={`group px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-all transform shadow-md ${
                isFormValid
                  ? mode === "issue"
                    ? "bg-rose-600 hover:bg-rose-700 text-white hover:scale-[1.02] active:scale-95 cursor-pointer shadow-rose-600/20"
                    : "bg-indigo-600 hover:bg-indigo-700 text-white hover:scale-[1.02] active:scale-95 cursor-pointer shadow-indigo-600/20"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
              }`}
            >
              <span>
                {submitting 
                  ? "Submitting..." 
                  : mode === "issue" 
                    ? "Submit Issue" 
                    : "Send Feedback"
                }
              </span>
              <IconSend className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
