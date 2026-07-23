import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { IconSparkles as Sparkles, IconBrandGithub as Github, IconBook as BookOpen, IconShieldCheck as ShieldCheck, IconLoader2 as Loader2 } from '@tabler/icons-react';
import { toast } from "react-hot-toast";
import { auth, googleProvider, githubProvider, signInWithPopup } from "../../config/firebase";

interface AuthPageProps {
  onLoginSuccess: (user: any) => void;
}

export default function AuthPage({ onLoginSuccess }: AuthPageProps) {
  const [loading, setLoading] = useState<"google" | "github" | null>(null);
  const [sparkles, setSparkles] = useState<Array<{ id: number; x: number; y: number; size: number; duration: number; delay: number }>>([]);
  const [imgError, setImgError] = useState(false);

  // MFA verification state
  const [mfaPrompt, setMfaPrompt] = useState<{ userId: string; userEmail?: string; userName?: string } | null>(null);
  const [totpCodeInput, setTotpCodeInput] = useState("");
  const [mfaVerifying, setMfaVerifying] = useState(false);

  useEffect(() => {
    // Generate floating sparkles for ambient background effect
    const newSparkles = Array.from({ length: 16 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 2,
      duration: Math.random() * 4 + 4,
      delay: Math.random() * 5,
    }));
    setSparkles(newSparkles);
  }, []);

  const handleOAuthSignIn = async (providerName: "google" | "github") => {
    setLoading(providerName);
    const toastId = toast.loading(`Authenticating with ${providerName === "google" ? "Google" : "GitHub"}...`);

    try {
      let email: string | null = null;
      let name: string | null = null;
      let avatarUrl: string | undefined = undefined;
      let uid: string | null = null;
      let githubUrl: string | undefined = undefined;

      if (providerName === "google") {
        try {
          const result = await signInWithPopup(auth, googleProvider);
          const user = result.user;
          uid = user.uid;
          email = user.email;
          name = user.displayName;
          avatarUrl = user.photoURL || undefined;
        } catch (firebaseErr: any) {
          console.warn("Google popup sign-in error:", firebaseErr);
          toast.dismiss(toastId);
          if (firebaseErr?.code === "auth/popup-closed-by-user" || firebaseErr?.code === "auth/cancelled-popup-request") {
            toast.error("Google sign-in popup was closed.");
          } else {
            toast.error("Google sign-in failed: " + (firebaseErr?.message || "Unknown error"));
          }
          setLoading(null);
          return;
        }
      } else if (providerName === "github") {
        try {
          const result = await signInWithPopup(auth, githubProvider);
          const user = result.user;
          uid = user.uid;
          email = user.email;
          name = user.displayName;
          avatarUrl = user.photoURL || undefined;
          const reloadInfo = (user as any)?.reloadUserInfo;
          const screenName = reloadInfo?.screenName || user.displayName || "";
          if (screenName) {
            githubUrl = `https://github.com/${screenName.replace(/^https?:\/\/(www\.)?github\.com\//i, "")}`;
          }
        } catch (firebaseErr: any) {
          console.warn("GitHub popup sign-in error:", firebaseErr);
          toast.dismiss(toastId);
          if (firebaseErr?.code === "auth/popup-closed-by-user" || firebaseErr?.code === "auth/cancelled-popup-request") {
            toast.error("GitHub sign-in popup was closed.");
          } else {
            toast.error("GitHub sign-in failed: " + (firebaseErr?.message || "Unknown error"));
          }
          setLoading(null);
          return;
        }
      }

      const cleanEmail = email ? email.trim().toLowerCase() : "";
      const cleanGithub = githubUrl ? githubUrl.trim() : "";
      const cleanName = name ? name.trim() : (cleanEmail ? cleanEmail.split("@")[0] : "User");

      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerName,
          uid: uid,
          email: cleanEmail,
          github: cleanGithub,
          name: cleanName,
          avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid || cleanEmail || providerName}`,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed.");
      }

      toast.dismiss(toastId);

      if (data.requiresMfa) {
        setMfaPrompt({
          userId: data.userId,
          userEmail: data.email,
          userName: data.name,
        });
        toast("Google Authenticator MFA required for this account.", { icon: "🔒" });
        return;
      }

      const loggedInUser = data.user;

      if (loggedInUser.email) localStorage.setItem("studybuddy_last_email", loggedInUser.email);
      if (loggedInUser.github) localStorage.setItem("studybuddy_last_github", loggedInUser.github);

      if (data.isNewUser) {
        toast.success(`Account created! Welcome to Study Buddy, ${loggedInUser.name}!`);
      } else {
        if (loggedInUser.status === 0) {
          toast("Welcome back! Your account is currently deactivated. Access settings to reactivate.", { icon: "🔒" });
        } else {
          toast.success(`Welcome back, ${loggedInUser.name}!`);
        }
      }

      localStorage.setItem("portal_user_id", loggedInUser.id);
      localStorage.setItem("portal_user", JSON.stringify(loggedInUser));
      onLoginSuccess(loggedInUser);
    } catch (err: any) {
      console.error("Auth error:", err);
      toast.error("Authentication error: " + (err.message || String(err)), { id: toastId });
    } finally {
      setLoading(null);
    }
  };

  const handleVerifyLoginMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaPrompt || !totpCodeInput.trim()) {
      toast.error("Please enter the 6-digit code from your Google Authenticator app.");
      return;
    }

    setMfaVerifying(true);
    try {
      const res = await fetch("/api/auth/mfa/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: mfaPrompt.userId,
          code: totpCodeInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");

      const loggedInUser = data.user;
      if (loggedInUser.email) localStorage.setItem("studybuddy_last_email", loggedInUser.email);
      if (loggedInUser.github) localStorage.setItem("studybuddy_last_github", loggedInUser.github);

      toast.success(`MFA Code Verified! Welcome back, ${loggedInUser.name || "User"}!`);
      localStorage.setItem("portal_user_id", loggedInUser.id);
      localStorage.setItem("portal_user", JSON.stringify(loggedInUser));
      onLoginSuccess(loggedInUser);
    } catch (err: any) {
      toast.error(err.message || "Failed to verify 2FA code.");
    } finally {
      setMfaVerifying(false);
    }
  };

  return (
    <main id="auth-page-container" className="w-full min-h-screen flex flex-col md:flex-row bg-[#0f1115] text-slate-100 select-none overflow-x-hidden font-sans">
      {/* Left Pane: Branding & Marketing */}
      <section className="relative w-full md:w-1/2 min-h-[45vh] md:min-h-screen flex flex-col items-center justify-center p-8 md:p-12 overflow-hidden bg-[#0c0e12] border-b md:border-b-0 md:border-r border-slate-800/40">
        {/* Background glow effects */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/15 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-1/3 left-1/3 w-80 h-80 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none" />

        {/* Ambient floating sparkles */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {sparkles.map((sp) => (
            <motion.div
              key={sp.id}
              className="absolute bg-white/40 rounded-full"
              style={{
                top: `${sp.y}%`,
                left: `${sp.x}%`,
                width: `${sp.size}px`,
                height: `${sp.size}px`,
              }}
              animate={{
                opacity: [0.1, 0.7, 0.1],
                scale: [0.8, 1.4, 0.8],
              }}
              transition={{
                duration: sp.duration,
                repeat: Infinity,
                delay: sp.delay,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>

        {/* Center Content */}
        <div className="relative z-10 text-center flex flex-col items-center max-w-md">
          {/* Logo Card */}
          <div className="mb-6 p-4 md:p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md shadow-2xl flex items-center justify-center">
            {!imgError ? (
              <img
                src="https://lh3.googleusercontent.com/aida/AP1WRLurp4d_mEbL06vyqtDVoN1XJRnyzX8bSQ2_Gu4LYsKSKFKieGmrzLhz03Uzvx_2H3uuKkp9nlEfYpcWhcTuvh1ICVNp2IIaGUyxoCqO7l_7ofIEifrQUGOKi5IgcsLYDlkaPPPVTpyMD9TmBRG_4q5m1nWBLT8zGD6ycxU-6EwzJ85ZwEXldZIRLJGDfAmYVoyHG16e9DtRygEOljCDqFrgoUlpBvqG39tjqMmIw8ZKGg9waqDqg6Pe"
                alt="Studdy Buddy Logo"
                onError={() => setImgError(true)}
                className="w-32 h-32 md:w-44 md:h-44 object-contain"
              />
            ) : (
              <div className="w-28 h-28 md:w-36 md:h-36 flex flex-col items-center justify-center text-blue-400 gap-2">
                <BookOpen className="w-16 h-16" />
                <span className="font-bold text-xs tracking-wider uppercase text-slate-300">Studdy Buddy</span>
              </div>
            )}
          </div>

          {/* Brand Name */}
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight mb-2">
            Studdy Buddy
          </h1>

          {/* Tagline */}
          <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-sm">
            Your ultimate companion to track, visualize, and conquer your syllabus.
          </p>

          {/* Decorative Badge */}
          <div className="mt-8 flex items-center gap-2 px-4 py-2 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 font-mono text-[11px] uppercase tracking-widest font-semibold shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Personal Study &amp; Syllabus Tracker</span>
          </div>
        </div>
      </section>

      {/* Right Pane: Authentication Canvas */}
      <section className="w-full md:w-1/2 min-h-[55vh] md:min-h-screen bg-[#181a1e] flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-[420px] bg-[#22252b]/90 backdrop-blur-md p-8 md:p-10 rounded-2xl shadow-2xl border border-slate-700/30 space-y-6">
          {mfaPrompt ? (
            <div className="space-y-5 animate-in fade-in duration-200">
              <header className="flex items-center gap-3 border-b border-slate-700/50 pb-4">
                <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Two-Factor Authentication</h2>
                  <p className="text-xs text-slate-400 font-mono">Google Authenticator TOTP</p>
                </div>
              </header>

              <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl text-xs text-slate-300 leading-relaxed font-sans">
                Enter the 6-digit verification code from your <strong className="text-white">Google Authenticator</strong> app for <span className="text-indigo-400 font-mono">{mfaPrompt.userEmail || mfaPrompt.userName || "your account"}</span>.
              </div>

              <form onSubmit={handleVerifyLoginMfa} className="space-y-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1.5 uppercase tracking-wider">
                    6-Digit Authenticator Code
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    autoFocus
                    placeholder="000000"
                    value={totpCodeInput}
                    onChange={(e) => setTotpCodeInput(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-4 py-3 bg-[#181a1e] border border-slate-600 rounded-xl text-lg font-mono font-extrabold tracking-widest text-center text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={mfaVerifying || totpCodeInput.length !== 6}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  {mfaVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Verify &amp; Continue
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMfaPrompt(null);
                    setTotpCodeInput("");
                  }}
                  className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer text-center"
                >
                  Cancel &amp; Back to Login
                </button>
              </form>
            </div>
          ) : (
            <>
              <header>
                <h2 className="text-2xl font-bold text-white mb-1 tracking-tight">Welcome</h2>
                <p className="text-xs text-slate-400 leading-normal">
                  Signin with google or github to continue your momentum.
                </p>
              </header>

              {/* Social Auth Grid */}
              <div className="grid grid-cols-1 gap-3.5">
                {/* Continue with Google */}
                <button
                  type="button"
                  id="google-login-btn"
                  onClick={() => handleOAuthSignIn("google")}
                  disabled={loading !== null}
                  className="flex items-center justify-center gap-3 w-full py-3.5 px-4 rounded-xl bg-white text-slate-900 font-semibold text-sm hover:bg-slate-100 transition-all active:scale-[0.98] shadow-md cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  {loading === "google" ? (
                    <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                  )}
                  <span>Continue with Google</span>
                </button>

                {/* Continue with GitHub */}
                <button
                  type="button"
                  id="github-login-btn"
                  onClick={() => handleOAuthSignIn("github")}
                  disabled={loading !== null}
                  className="flex items-center justify-center gap-3 w-full py-3.5 px-4 rounded-xl bg-[#24292f] text-white font-semibold text-sm hover:bg-[#1a1e22] transition-all active:scale-[0.98] border border-white/10 shadow-md cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  {loading === "github" ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Github className="w-5 h-5 shrink-0 text-white" />
                  )}
                  <span>Continue with GitHub</span>
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
