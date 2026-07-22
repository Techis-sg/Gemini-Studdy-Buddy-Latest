import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  memoryLocalCache,
  setLogLevel,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  writeBatch,
} from "firebase/firestore";

setLogLevel("error");
import fs from "fs";
import path from "path";
import { Dashboard, Subject, Task, TimeLog, TaskAttachment } from "@/types";

// Load configuration
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.warn("Failed to parse firebase-applet-config.json:", err);
  }
} else {
  console.warn("firebase-applet-config.json not found in root directory");
}

// Initialize Firebase
const app = initializeApp({
  apiKey: firebaseConfig.apiKey || "mock-api-key",
  authDomain: firebaseConfig.authDomain || "mock.firebaseapp.com",
  projectId: firebaseConfig.projectId || "mock-project",
  storageBucket: firebaseConfig.storageBucket || "mock.appspot.com",
  messagingSenderId: firebaseConfig.messagingSenderId || "000000000000",
  appId: firebaseConfig.appId || "1:000000000000:web:mock",
});

const serverDatabaseId = firebaseConfig.firestoreDatabaseId || "(default)";

// Initialize Firestore with memory cache
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
}, serverDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, userId?: string): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errInfo = {
    error: errorMessage,
    operationType,
    path,
    authInfo: {
      userId: userId || null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
    }
  };
  const jsonString = JSON.stringify(errInfo);
  console.error('Firestore Error: ', jsonString);
  throw new Error(jsonString);
}

import { getInitialDefaultData } from "./mockData";

/**
 * Normalizes userId for DB queries
 */
function getNormalizedUserId(userId: string | undefined): string {
  if (!userId || userId === "null" || userId === "undefined" || userId === "anonymous") {
    return "anonymous";
  }
  return userId;
}

/**
 * Recursively cleans undefined fields from an object for Firestore compatibility
 */
function cleanUndefined(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined);
  }
  if (typeof obj === "object") {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        cleaned[key] = cleanUndefined(val);
      }
    }
    return cleaned;
  }
  return obj;
}

/**
 * Wrapper for setDoc that automatically cleans any undefined properties recursively
 */
async function safeSetDoc(ref: any, data: any, options?: any): Promise<void> {
  const cleanedData = cleanUndefined(data);
  if (options) {
    await setDoc(ref, cleanedData, options);
  } else {
    await setDoc(ref, cleanedData);
  }
}

/**
 * Seed default template plan into Firestore for a new user
 */
export async function seedUserData(userId: string): Promise<{
  dashboards: Dashboard[];
  subjects: Record<string, Subject[]>;
  tasks: Record<string, Task[]>;
}> {
  const normUid = getNormalizedUserId(userId);
  const defaultData = getInitialDefaultData();

  try {
    // Seed Dashboards
    for (const dash of defaultData.dashboards) {
      const dashRef = doc(db, "users", normUid, "dashboards", dash.id);
      await safeSetDoc(dashRef, dash);
    }

    // Seed Subjects
    for (const subj of defaultData.subjects) {
      const subjRef = doc(db, "users", normUid, "subjects", subj.id);
      await safeSetDoc(subjRef, subj);
    }

    // Seed Tasks
    for (const task of defaultData.tasks) {
      const taskRef = doc(db, "users", normUid, "tasks", task.id);
      await safeSetDoc(taskRef, task);
    }

    // Fetch back to return properly structured shape
    return await fetchUserDashboardData(normUid);
  } catch (error) {
    console.warn("Firestore database seeding failed. Falling back to offline static data.", error);
    
    // In case of write failure (offline or rule rejection), return static local plan data mapped cleanly
    const subjectsMap: Record<string, Subject[]> = { "default": defaultData.subjects };
    const tasksMap: Record<string, Task[]> = { "default": defaultData.tasks };
    
    return {
      dashboards: defaultData.dashboards,
      subjects: subjectsMap,
      tasks: tasksMap,
    };
  }
}

/**
 * Fetch complete dashboard, subjects, and tasks data for a user
 */
export async function fetchUserDashboardData(userId: string | undefined): Promise<{
  dashboards: Dashboard[];
  subjects: Record<string, Subject[]>;
  tasks: Record<string, Task[]>;
}> {
  const normUid = getNormalizedUserId(userId);

  try {
    // 1. Fetch Dashboards
    const dashCol = collection(db, "users", normUid, "dashboards");
    const dashSnap = await getDocs(dashCol);
    
    if (dashSnap.empty) {
      // No dashboards found, return empty collections
      return {
        dashboards: [],
        subjects: {},
        tasks: {},
      };
    }

    const dashboards: Dashboard[] = [];
    dashSnap.forEach((doc) => {
      dashboards.push(doc.data() as Dashboard);
    });

    // 2. Fetch Subjects
    const subjCol = collection(db, "users", normUid, "subjects");
    const subjSnap = await getDocs(subjCol);
    const subjectsMap: Record<string, Subject[]> = {};
    
    // By default we associate subjects to the "default" dashboard or first available
    const defaultDashId = dashboards[0]?.id || "default";

    const subjectsList: Subject[] = [];
    subjSnap.forEach((doc) => {
      subjectsList.push(doc.data() as Subject);
    });

    // Organize by dashboardId (Since our entity schema has subjects map as Record<dashboardId, Subject[]>)
    dashboards.forEach((d) => {
      subjectsMap[d.id] = [];
    });
    
    subjectsList.forEach((sub) => {
      // Use dashboardId property on the subject if set, or fall back to defaultDashId
      const dId = (sub as any).dashboardId || defaultDashId;
      if (!subjectsMap[dId]) {
        subjectsMap[dId] = [];
      }
      subjectsMap[dId].push(sub);
    });

    // 3. Fetch Tasks
    const tasksCol = collection(db, "users", normUid, "tasks");
    const tasksSnap = await getDocs(tasksCol);
    const tasksMap: Record<string, Task[]> = {};

    dashboards.forEach((d) => {
      tasksMap[d.id] = [];
    });

    tasksSnap.forEach((doc) => {
      const task = doc.data() as Task;
      const dId = task.dashboardId || defaultDashId;
      if (!tasksMap[dId]) {
        tasksMap[dId] = [];
      }
      tasksMap[dId].push(task);
    });

    // Ensure every task has taskId & taskid populated sequentially
    for (const dId of Object.keys(tasksMap)) {
      tasksMap[dId] = tasksMap[dId].map((t, idx) => {
        const seqTaskId = t.taskId || t.taskid || `TSK-${String(idx + 1).padStart(3, "0")}`;
        return {
          ...t,
          taskId: seqTaskId,
          taskid: seqTaskId,
        };
      });
    }

    // Dynamic database auto-updater to shift old hardcoded dates (e.g. 2026-07-11 to 2026-07-15) relative to today
    const referenceDate = new Date("2026-07-13");
    for (const dId of Object.keys(tasksMap)) {
      for (const t of tasksMap[dId]) {
        if (t.date && (
          t.date === "2026-07-11" || 
          t.date === "2026-07-12" || 
          t.date === "2026-07-13" || 
          t.date === "2026-07-14" || 
          t.date === "2026-07-15"
        )) {
          const tDate = new Date(t.date);
          const diffTime = tDate.getTime() - referenceDate.getTime();
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
          
          const newD = new Date();
          newD.setDate(newD.getDate() + diffDays);
          const y = newD.getFullYear();
          const m = String(newD.getMonth() + 1).padStart(2, "0");
          const day = String(newD.getDate()).padStart(2, "0");
          t.date = `${y}-${m}-${day}`;

          if (t.timeLogs) {
            t.timeLogs = t.timeLogs.map((log: any) => {
              if (log.loggedAt && log.loggedAt.includes("2026-07-")) {
                const logParts = log.loggedAt.split("T")[0].split("-");
                if (logParts.length === 3) {
                  const logD = new Date(parseInt(logParts[0], 10), parseInt(logParts[1], 10) - 1, parseInt(logParts[2], 10));
                  const logDiff = logD.getTime() - referenceDate.getTime();
                  const logDiffDays = Math.round(logDiff / (1000 * 60 * 60 * 24));
                  const newLogD = new Date();
                  newLogD.setDate(newLogD.getDate() + logDiffDays);
                  log.loggedAt = newLogD.toISOString();
                }
              }
              return log;
            });
          }

          await saveUserTask(normUid, t);
        }
      }
    }

    const todayDateObj = new Date();
    const todayY = todayDateObj.getFullYear();
    const todayM = String(todayDateObj.getMonth() + 1).padStart(2, "0");
    const todayD = String(todayDateObj.getDate()).padStart(2, "0");
    const todayStr = `${todayY}-${todayM}-${todayD}`;

    for (const dId of Object.keys(tasksMap)) {
      for (const t of tasksMap[dId]) {
        let expectedCol: Task["boardColumnId"] = t.boardColumnId || "backlog";
        if (t.boardColumnId === "revision" || t.status === "Revision") {
          expectedCol = "revision";
        } else if (t.boardColumnId === "completed" || t.status === "Completed") {
          expectedCol = "completed";
        } else if (t.boardColumnId === "in_progress" || t.status === "In Progress") {
          expectedCol = "in_progress";
        } else if (t.boardColumnId === "today") {
          expectedCol = "today";
        } else if (t.boardColumnId === "backlog") {
          expectedCol = "backlog";
        } else if (t.date === todayStr) {
          expectedCol = "today";
        } else {
          expectedCol = "backlog";
        }

        if (t.boardColumnId !== expectedCol) {
          t.boardColumnId = expectedCol;
          try {
            await saveUserTask(normUid, t);
          } catch (e) {
            console.warn("Failed to auto-save normalized task column", e);
          }
        }
      }
    }

    for (const d of dashboards) {
      if (d.statusOverview && (d.statusOverview.includes("July 10, 2026") || d.statusOverview.includes("July 13, 2026"))) {
        const dObj = new Date();
        const mName = dObj.toLocaleDateString("en-US", { month: "long" });
        d.statusOverview = `Current Status — ${mName} ${dObj.getDate()}, ${dObj.getFullYear()}`;
        await saveUserDashboard(normUid, d);
      }
    }

    return { dashboards, subjects: subjectsMap, tasks: tasksMap };
  } catch (error) {
    console.warn("Firestore database fetch failed. Returning empty collections.", error);
    return {
      dashboards: [],
      subjects: {},
      tasks: {},
    };
  }
}

/**
 * Save user profile info
 */
export async function saveUserProfile(userId: string, userData: any): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  const userRef = doc(db, "users", normUid);
  try {
    await safeSetDoc(userRef, {
      ...userData,
      id: normUid,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    console.warn("Failed to save user profile to Firestore:", error);
  }
}

/**
 * Get user profile info
 */
export async function getUserProfile(userId: string): Promise<any> {
  const normUid = getNormalizedUserId(userId);
  const userRef = doc(db, "users", normUid);
  try {
    const snap = await getDoc(userRef);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.warn("Failed to fetch user profile from Firestore:", error);
    return null;
  }
}

/**
 * Get user profile by email address
 */
export async function getUserProfileByEmail(email: string): Promise<any> {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();
  const fallbackId = `google_${cleanEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;

  // 1. Try direct getDoc by deterministic document ID first
  try {
    const directSnap = await getDoc(doc(db, "users", fallbackId));
    if (directSnap.exists()) {
      return directSnap.data();
    }
  } catch (err) {
    console.warn("Direct getDoc check by ID failed:", err);
  }

  // 2. Fall back to collection query if direct doc was not found
  try {
    const col = collection(db, "users");
    const q = query(col, where("email", "==", cleanEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].data();
    }
    return null;
  } catch (error) {
    console.warn("Querying user profile by email collection query failed:", error);
    return null;
  }
}

/**
 * Get user profile by github URL, username, or linked email
 */
export async function getUserProfileByGithub(githubUrlOrUsername: string): Promise<any> {
  if (!githubUrlOrUsername) return null;
  const cleanGithub = githubUrlOrUsername.trim().toLowerCase();
  
  const match = cleanGithub.match(/github\.com\/([^\/]+)/);
  const username = (match ? match[1] : cleanGithub.replace(/^https?:\/\//, "").replace(/\//g, "")).replace(/^@/, "").trim().toLowerCase();

  if (!username && !cleanGithub) return null;

  try {
    const col = collection(db, "users");
    const snap = await getDocs(col);
    if (!snap.empty) {
      for (const docSnap of snap.docs) {
        const u = docSnap.data();
        let uGithub = u.github ? u.github.trim().toLowerCase() : "";
        let uEmail = u.email ? u.email.trim().toLowerCase() : "";

        // Also inspect user settings subcollection
        try {
          const settingsSnap = await getDoc(doc(db, "users", docSnap.id, "settings", "info"));
          if (settingsSnap.exists()) {
            const sData = settingsSnap.data();
            if (!uGithub && sData?.github) {
              uGithub = sData.github.trim().toLowerCase();
            }
            if (!uEmail && sData?.email) {
              uEmail = sData.email.trim().toLowerCase();
            }
          }
        } catch (e) {
          // ignore subcollection read errors
        }

        if (uGithub) {
          const uMatch = uGithub.match(/github\.com\/([^\/]+)/);
          const uUser = (uMatch ? uMatch[1] : uGithub.replace(/^https?:\/\//, "").replace(/\//g, "")).replace(/^@/, "").trim().toLowerCase();
          if (uUser === username || uGithub === cleanGithub || uGithub.includes(username)) {
            return u;
          }
        }

        if (cleanGithub.includes("@") && uEmail && uEmail === cleanGithub) {
          return u;
        }
      }
    }
    return null;
  } catch (error) {
    console.warn("Querying user profile by github failed:", error);
    return null;
  }
}

/**
 * Get any existing active user profile in Firestore
 */
export async function getAnyExistingUser(): Promise<any> {
  try {
    const col = collection(db, "users");
    const snap = await getDocs(col);
    if (!snap.empty) {
      for (const docSnap of snap.docs) {
        const u = docSnap.data();
        if (u && !u.isBlocked && u.status !== 2) {
          return u;
        }
      }
      return snap.docs[0].data();
    }
    return null;
  } catch (error) {
    console.warn("getAnyExistingUser check failed:", error);
    return null;
  }
}

/**
 * Create or save a dashboard
 */
export async function saveUserDashboard(userId: string | undefined, dashboard: Dashboard): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  const ref = doc(db, "users", normUid, "dashboards", dashboard.id);
  try {
    await safeSetDoc(ref, dashboard, { merge: true });
  } catch (error) {
    console.warn("Failed to save dashboard to Firestore:", error);
  }
}

/**
 * Delete a dashboard and cascade-delete its items
 */
export async function deleteUserDashboard(userId: string | undefined, dashboardId: string): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  try {
    // Delete dashboard doc
    const dashRef = doc(db, "users", normUid, "dashboards", dashboardId);
    await deleteDoc(dashRef);

    // Clean up tasks associated with this dashboard
    const tasksCol = collection(db, "users", normUid, "tasks");
    const tasksSnap = await getDocs(tasksCol);
    for (const tDoc of tasksSnap.docs) {
      const t = tDoc.data() as Task;
      if (t.dashboardId === dashboardId) {
        await deleteDoc(doc(db, "users", normUid, "tasks", t.id));
      }
    }
  } catch (error) {
    console.warn("Failed to delete dashboard from Firestore:", error);
  }
}

/**
 * Save or update a task
 */
export async function saveUserTask(userId: string | undefined, task: Task): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  const ref = doc(db, "users", normUid, "tasks", task.id);
  try {
    await safeSetDoc(ref, task, { merge: true });
  } catch (error) {
    console.warn("Failed to save task to Firestore:", error);
  }
}

/**
 * Delete a task
 */
export async function deleteUserTask(userId: string | undefined, taskId: string): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  const ref = doc(db, "users", normUid, "tasks", taskId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    console.warn("Failed to delete task from Firestore:", error);
  }
}

/**
 * Save or update a subject
 */
export async function saveUserSubject(userId: string | undefined, subject: Subject): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  const ref = doc(db, "users", normUid, "subjects", subject.id);
  try {
    await safeSetDoc(ref, subject, { merge: true });
  } catch (error) {
    console.warn("Failed to save subject to Firestore:", error);
  }
}

/**
 * Delete a subject
 */
export async function deleteUserSubject(userId: string | undefined, subjectId: string): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  try {
    // Delete subject
    const ref = doc(db, "users", normUid, "subjects", subjectId);
    await deleteDoc(ref);

    // Update tasks referencing this subject
    const tasksCol = collection(db, "users", normUid, "tasks");
    const tasksSnap = await getDocs(tasksCol);
    for (const tDoc of tasksSnap.docs) {
      const t = tDoc.data() as Task;
      if (t.subjectId === subjectId) {
        const updatedTask = { ...t };
        delete updatedTask.subjectId;
        await safeSetDoc(doc(db, "users", normUid, "tasks", t.id), updatedTask);
      }
    }
  } catch (error) {
    console.warn("Failed to delete subject from Firestore:", error);
  }
}

/**
 * Save user custom settings
 */
export async function saveUserSettings(userId: string | undefined, settings: any): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  const ref = doc(db, "users", normUid, "settings", "info");
  try {
    await safeSetDoc(ref, settings, { merge: true });
  } catch (error) {
    console.warn("Failed to save user settings to Firestore:", error);
  }
}

/**
 * Get user custom settings
 */
export async function getUserSettings(userId: string | undefined): Promise<any> {
  const normUid = getNormalizedUserId(userId);
  const ref = doc(db, "users", normUid, "settings", "info");
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.warn("Failed to fetch user settings from Firestore:", error);
    return null;
  }
}

/**
 * Add history action log
 */
export async function addHistoryLog(userId: string | undefined, log: any): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  const logId = log.id || ("log_" + Date.now());
  const ref = doc(db, "users", normUid, "history", logId);
  try {
    await safeSetDoc(ref, log, { merge: true });
  } catch (error) {
    console.warn("Failed to save history log to Firestore:", error);
  }
}

/**
 * Get history action logs
 */
export async function getHistoryLogs(userId: string | undefined): Promise<any[]> {
  const normUid = getNormalizedUserId(userId);
  const path = `users/${normUid}/history`;
  try {
    const col = collection(db, "users", normUid, "history");
    const snap = await getDocs(col);
    const logs: any[] = [];
    snap.forEach((doc) => {
      logs.push(doc.data());
    });
    // Sort by timestamp desc
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (error) {
    console.warn("Failed to fetch history logs from Firestore:", error);
    return [];
  }
}

/**
 * Save user feedback record to Firestore
 */
export async function saveFeedback(feedback: {
  id?: string;
  user_id?: string;
  user_email?: string;
  user_name?: string;
  date?: string;
  feedback_message?: string;
  ai_tag?: string;
  type?: string;
  screenshots?: string[];
}): Promise<string> {
  const normUid = feedback.user_id ? getNormalizedUserId(feedback.user_id) : "anonymous";
  const feedbackId = feedback.id || ("fb_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7));
  const ref = doc(db, "feedbacks", feedbackId);
  try {
    await safeSetDoc(ref, { id: feedbackId, ...feedback }, { merge: true });
    return feedbackId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `feedbacks/${feedbackId}`, normUid);
    return feedbackId;
  }
}

/**
 * Get all user feedback records
 */
export async function getFeedbacks(): Promise<any[]> {
  try {
    const col = collection(db, "feedbacks");
    const snap = await getDocs(col);
    const feedbacks: any[] = [];
    snap.forEach((d) => {
      feedbacks.push(d.data());
    });
    return feedbacks.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error("Error fetching feedbacks:", error);
    return [];
  }
}

/**
 * Export all user workspace data package
 */
export async function exportUserData(userId: string | undefined): Promise<any> {
  const normUid = getNormalizedUserId(userId);
  const profile = await getUserProfile(normUid);
  const settings = await getUserSettings(normUid);
  const dashboardData = await fetchUserDashboardData(normUid);
  const historyLogs = await getHistoryLogs(normUid);

  return {
    exportDate: new Date().toISOString(),
    user: profile,
    settings,
    dashboards: dashboardData.dashboards,
    subjects: dashboardData.subjects,
    tasks: dashboardData.tasks,
    historyLogs,
  };
}

/**
 * Save user data export request document
 */
export async function saveDataExportRequest(userId: string | undefined, userEmail: string): Promise<string> {
  const normUid = getNormalizedUserId(userId);
  const requestId = "exp_" + Date.now();
  const reqRef = doc(db, "data_export_requests", requestId);
  await safeSetDoc(reqRef, {
    id: requestId,
    userId: normUid,
    userEmail: userEmail,
    requestedAt: new Date().toISOString(),
    status: "pending",
  });
  return requestId;
}

/**
 * Delete all user data permanently from Firestore
 */
export async function deleteUserData(userId: string | undefined): Promise<void> {
  const normUid = getNormalizedUserId(userId);
  try {
    // 1. Delete subcollections
    const subcollections = ["dashboards", "subjects", "tasks", "history", "settings"];
    for (const sub of subcollections) {
      try {
        const colRef = collection(db, "users", normUid, sub);
        const snap = await getDocs(colRef);
        for (const docSnap of snap.docs) {
          await deleteDoc(doc(db, "users", normUid, sub, docSnap.id));
        }
      } catch (subErr) {
        console.warn(`Error clearing subcollection ${sub} for user ${normUid}:`, subErr);
      }
    }

    // 2. Mark user profile doc as status: 2 (Deleted) and purge personal data
    const userRef = doc(db, "users", normUid);
    const snap = await getDoc(userRef);
    const existing = snap.exists() ? snap.data() : {};
    await safeSetDoc(userRef, {
      id: normUid,
      email: existing.email || "",
      name: "Deleted User",
      status: 2,
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to purge user data from Firestore:", err);
    throw err;
  }
}

