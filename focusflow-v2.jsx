import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// API + HAPTICS CONFIG
// ═══════════════════════════════════════════════════════════════════════════
const API_URL = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
  ? "/api/claude"
  : "https://focusflow-proxy.ananthrao.workers.dev";

const haptic = (style = "LIGHT") => {
  try {
    if (window.Capacitor?.isNativePlatform()) {
      window.Capacitor.Plugins.Haptics.impact({ style });
    } else {
      navigator.vibrate?.(10);
    }
  } catch {}
};

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE LAYER
// ═══════════════════════════════════════════════════════════════════════════
const KEYS = {
  profile: "ff-profile",
  goals: "ff-goals",
  quarters: "ff-quarters",
  weeklyTasks: "ff-weekly",
  dailyBig3: "ff-daily",
  otherTodos: "ff-todos",
  journal: "ff-journal",
  chatHistory: "ff-chat",
  streaks: "ff-streaks",
  mindDump: "ff-minddump",
};

const store = {
  async get(key) {
    try {
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  },
  async set(key, val) {
    try { await window.storage.set(key, JSON.stringify(val)); } catch (e) { console.error("store.set", e); }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const today = () => new Date().toISOString().split("T")[0];
const getQ = (d = new Date()) => `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
const getWeekId = (d = new Date()) => {
  const s = new Date(d.getFullYear(), 0, 1);
  return `W${Math.ceil(((d - s) / 864e5 + s.getDay() + 1) / 7)}-${d.getFullYear()}`;
};
const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const timeOfDay = () => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE API - COACH ENGINE
// ═══════════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are FocusFlow Coach, a personal productivity coach built on the Full Focus Planner system by Michael Hyatt. You combine deep knowledge of goal achievement science with warm, direct coaching.

CORE METHODOLOGY:
- SMARTER Goals: Specific, Measurable, Actionable, Risky (stretches them), Time-keyed, Exciting, Relevant (connected to deep values)
- Hierarchy: Annual Goals → Quarterly Milestones → Weekly Outcomes → Daily Big 3
- The Big 3: Only 3 tasks per day that matter most. Forces ruthless prioritization.
- Weekly Preview: Plan the week before it happens
- Daily "What's on your mind?" brain dump → distill into Big 3

YOUR COACHING STYLE:
- Direct and honest. No fluff. Talk like a sharp colleague, not a therapist.
- Push back on vague goals. "Grow my business" is not a goal. Make them get specific.
- Always connect goals to personal values and meaning. WHY does this matter to them?
- Consider their season of life (family stage, energy, time constraints) when helping them plan
- When they set a goal, guide them to break it down: what does this look like this quarter? This week? Today?
- Celebrate wins without being cheesy. A simple "That's a full sweep. Well done." beats emojis and exclamation marks.
- When they brain dump, help them see what's actually important vs. what feels urgent
- Flag recurring to-dos as potential systems or habits to build
- Keep responses concise. 2-4 sentences usually. This is mobile. Walls of text don't work.
- Never say "you've got this", "great job", "awesome", "amazing", or similar. Be warm but not performative.

SMARTER GOAL REFINEMENT FLOW:
When someone shares a goal, check each element:
1. Is it Specific? (Can you picture the finish line?)
2. Is it Measurable? (How will you know you hit it?)
3. Is it Actionable? (Is this in your control?)
4. Is it Risky? (Does it stretch you? If it's comfortable, it's too small.)
5. Is it Time-keyed? (By when?)
6. Is it Exciting? (Does this light you up?)
7. Is it Relevant? (Connected to what you deeply value?)

Don't run through all 7 like a checklist. Be conversational. Start with the weakest element.

CONTEXT HANDLING:
- You'll receive the user's profile, current goals, recent tasks, and memory
- Use this context naturally. Reference their goals, notice patterns, remember what they've told you.
- If they seem overwhelmed, help them simplify. If they seem unfocused, help them prioritize.
- Never repeat information they've already given you.

FORMATTING:
- No markdown formatting (no **, no ##, no bullet points with *)
- Keep it conversational. Short paragraphs.
- Never use em dashes. Use periods or commas instead.
- Don't use emojis unless the user does first.

TOOL USE - CRITICAL:
You MUST use the provided tools to add goals, tasks, milestones, weekly outcomes, to-dos, and reflections. Never describe adding them in text. Always call the tool.
You can call multiple tools in one response. For example, after a brain dump you might call add_big3 three times and add_todo several times.
When referencing existing items (to complete or link milestones), use the IDs provided in the context block.
If Big 3 is already full (3 tasks for today in context), do NOT call add_big3. Instead, ask the user which existing task to replace or offer to add it as a to-do.
When a user wants to set a goal, walk them through SMARTER refinement first, THEN call add_goal once the goal is tight.
After creating a goal, proactively offer to break it down into quarterly milestones using add_milestone with the new goal's ID.`;

const callClaude = async (messages, profile, context) => {
  const contextBlock = `
USER PROFILE: ${JSON.stringify(profile || {})}
CURRENT GOALS (with IDs for linking milestones): ${JSON.stringify(context?.goals || [])}
TODAY'S BIG 3: ${JSON.stringify(context?.todayTasks || [])}
OTHER TODOS: ${JSON.stringify(context?.otherTodos || [])}
QUARTERLY MILESTONES: ${JSON.stringify(context?.quarters || [])}
WEEKLY OUTCOMES: ${JSON.stringify(context?.weeklyTasks || [])}
STREAK: ${context?.streak || 0} days
TIME OF DAY: ${timeOfDay()}
TODAY'S DATE: ${today()}
CURRENT QUARTER: ${getQ()}
CURRENT WEEK: ${getWeekId()}
RECENT REFLECTIONS: ${JSON.stringify((context?.journal || []).slice(-5))}
`;

  // Build messages array - must support both string and array content (for tool_use/tool_result)
  const apiMessages = [];

  if (messages.length === 0) {
    // Initial greeting - no prior messages
    apiMessages.push({
      role: "user",
      content: `[CONTEXT - DO NOT REPEAT THIS TO USER]\n${contextBlock}\n[END CONTEXT]\n\nPlease greet or respond based on context.`
    });
  } else {
    // Filter to last 30 messages for context window management
    const recent = messages.slice(-30);
    recent.forEach((m, i) => {
      if (i === 0 && m.role === "user" && typeof m.content === "string") {
        // Embed context in first user message
        apiMessages.push({
          role: "user",
          content: `[CONTEXT]\n${contextBlock}\n[END CONTEXT]\n\n${m.content}`
        });
      } else {
        // CRITICAL: Pass content as-is. It may be a string OR an array
        // (tool_use assistant messages and tool_result user messages have array content)
        apiMessages.push({ role: m.role, content: m.content });
      }
    });
    // Ensure first message is from user (API requirement)
    if (apiMessages.length === 0 || apiMessages[0].role !== "user") {
      apiMessages.unshift({
        role: "user",
        content: `[CONTEXT]\n${contextBlock}\n[END CONTEXT]\n\nPlease respond based on context.`
      });
    }
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: apiMessages,
        tools: TOOL_DEFINITIONS,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const errMsg = data?.error?.message || `API error ${response.status}`;
      console.error("Claude API error:", response.status, errMsg);
      return {
        content: [{ type: "text", text: response.status === 401
          ? "API key not configured. Add your Anthropic API key to the .env file and restart the server."
          : `API error: ${errMsg}` }],
        stop_reason: "end_turn"
      };
    }
    // Return full response object (not just text) so agentic loop can inspect tool_use blocks
    return data;
  } catch (e) {
    console.error("Claude API error:", e);
    return {
      content: [{ type: "text", text: "Can't reach the server. Check your connection." }],
      stop_reason: "end_turn"
    };
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS FOR CLAUDE API
// ═══════════════════════════════════════════════════════════════════════════
const TOOL_DEFINITIONS = [
  {
    name: "add_goal",
    description: "Creates a new annual goal. Use after walking the user through SMARTER refinement. The goal should be Specific, Measurable, Actionable, Risky, Time-keyed, Exciting, and Relevant.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The goal title, clear and specific" },
        why: { type: "string", description: "Why this goal matters to the user, their deeper motivation" },
        smpieces: { type: "string", description: "SMARTER breakdown: measurable criteria, deadline, what makes it risky and exciting" }
      },
      required: ["title"]
    }
  },
  {
    name: "add_milestone",
    description: "Creates a quarterly milestone linked to an existing goal. Milestones are realistic checkpoints toward the annual goal. Use the goal's ID from context.",
    input_schema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "ID of the parent goal this milestone belongs to (from context)" },
        milestone: { type: "string", description: "What specifically will be achieved this quarter" },
        quarter: { type: "string", description: "Quarter string like 'Q1 2026'. Defaults to current quarter if not specified." }
      },
      required: ["goalId", "milestone"]
    }
  },
  {
    name: "add_weekly_outcome",
    description: "Adds a weekly outcome for the current or specified week. Weekly outcomes should feed into quarterly milestones.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The weekly outcome, something measurable and achievable this week" },
        weekId: { type: "string", description: "Week identifier like 'W9-2026'. Defaults to current week if not specified." }
      },
      required: ["title"]
    }
  },
  {
    name: "add_big3",
    description: "Adds a task to today's Big 3. HARD CAP: maximum 3 tasks per day. Check context first. If 3 already exist, do NOT call this. Ask the user which to replace or suggest adding as a to-do instead.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The task description, clear and actionable" },
        date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today if not specified." }
      },
      required: ["title"]
    }
  },
  {
    name: "add_todo",
    description: "Adds an item to the Other To-Dos list. Use for tasks that don't belong in the Big 3, or overflow items from a brain dump.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The to-do item" },
        date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." }
      },
      required: ["title"]
    }
  },
  {
    name: "complete_task",
    description: "Marks a task as done. Can complete Big 3 tasks, to-dos, weekly outcomes, or milestones. Use the task's ID from context.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The ID of the task to complete (from context)" },
        taskType: {
          type: "string",
          enum: ["big3", "todo", "weekly", "milestone"],
          description: "Which list the task belongs to"
        }
      },
      required: ["taskId", "taskType"]
    }
  },
  {
    name: "add_reflection",
    description: "Stores a journal or reflection entry. Use when the user shares insights, gratitude, lessons learned, or end-of-day reflections.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The reflection content" },
        type: {
          type: "string",
          enum: ["reflection", "insight", "gratitude", "lesson"],
          description: "The type of journal entry. Defaults to reflection."
        }
      },
      required: ["text"]
    }
  }
];

// ═══════════════════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════════════════
const I = {
  target: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  cal: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  sun: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  chat: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  plus: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  flame: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>,
  spark: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  arrow: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  list: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  repeat: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  brain: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 0-4 4v1a3 3 0 0 0-3 3 3 3 0 0 0 1 2.24 4 4 0 0 0 2 7.26V20a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-.5a4 4 0 0 0 2-7.26A3 3 0 0 0 19 10a3 3 0 0 0-3-3V6a4 4 0 0 0-4-4z"/></svg>,
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function FocusFlow() {
  // ── State ──────────────────────────────────────────────────────────────
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [onboardStep, setOnboardStep] = useState(0);
  const [onboardData, setOnboardData] = useState({ name: "", role: "", familyStage: "", timeAvailable: "", energyPattern: "", context: "" });

  const [goals, setGoals] = useState([]);
  const [quarters, setQuarters] = useState([]);
  const [weeklyTasks, setWeeklyTasks] = useState([]);
  const [dailyBig3, setDailyBig3] = useState([]);
  const [otherTodos, setOtherTodos] = useState([]);
  const [journal, setJournal] = useState([]);
  const [streaks, setStreaks] = useState({ daily: 0, lastDate: null });
  const [mindDump, setMindDump] = useState({ text: "", date: null });

  const [tab, setTab] = useState("today");
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showAddTodo, setShowAddTodo] = useState(false);
  const [newTodo, setNewTodo] = useState("");
  const [showMindDump, setShowMindDump] = useState(false);
  const [dumpText, setDumpText] = useState("");

  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const apiHistoryRef = useRef([]);       // Full API message history (includes tool_use/tool_result)
  const pendingGoalIds = useRef(new Set()); // Track goal IDs created mid-agentic-loop

  // ── Load all data ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [p, g, q, w, d, o, j, s, m] = await Promise.all([
        store.get(KEYS.profile),
        store.get(KEYS.goals),
        store.get(KEYS.quarters),
        store.get(KEYS.weeklyTasks),
        store.get(KEYS.dailyBig3),
        store.get(KEYS.otherTodos),
        store.get(KEYS.journal),
        store.get(KEYS.streaks),
        store.get(KEYS.mindDump),
      ]);
      if (p) setProfile(p);
      if (g) setGoals(g);
      if (q) setQuarters(q);
      if (w) setWeeklyTasks(w);
      if (d) setDailyBig3(d);
      if (o) setOtherTodos(o);
      if (j) setJournal(j);
      if (s) setStreaks(s);
      if (m) setMindDump(m);
      setReady(true);
    })();
  }, []);

  // ── Auto-save ──────────────────────────────────────────────────────────
  useEffect(() => { if (ready && profile) store.set(KEYS.profile, profile); }, [profile, ready]);
  useEffect(() => { if (ready) store.set(KEYS.goals, goals); }, [goals, ready]);
  useEffect(() => { if (ready) store.set(KEYS.quarters, quarters); }, [quarters, ready]);
  useEffect(() => { if (ready) store.set(KEYS.weeklyTasks, weeklyTasks); }, [weeklyTasks, ready]);
  useEffect(() => { if (ready) store.set(KEYS.dailyBig3, dailyBig3); }, [dailyBig3, ready]);
  useEffect(() => { if (ready) store.set(KEYS.otherTodos, otherTodos); }, [otherTodos, ready]);
  useEffect(() => { if (ready) store.set(KEYS.journal, journal); }, [journal, ready]);
  useEffect(() => { if (ready) store.set(KEYS.streaks, streaks); }, [streaks, ready]);
  useEffect(() => { if (ready) store.set(KEYS.mindDump, mindDump); }, [mindDump, ready]);

  // ── Chat scroll ────────────────────────────────────────────────────────
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs]);

  // ── Streaks ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const t = today();
    const todayT = dailyBig3.filter(x => x.date === t);
    if (todayT.length > 0 && streaks.lastDate !== t) {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split("T")[0];
      setStreaks({ daily: streaks.lastDate === yStr ? streaks.daily + 1 : 1, lastDate: t });
    }
  }, [dailyBig3, ready]);

  // ── Initial coach message ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !profile) return;
    if (chatMsgs.length > 0) return;
    const initCoach = async () => {
      setChatLoading(true);
      const ctx = buildContext();
      const response = await callClaude([], profile, ctx);
      const text = (response.content || [])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("") || "I'm here. What's on your mind?";
      setChatMsgs([{ role: "assistant", content: text }]);
      // Initialize API history with the greeting exchange
      apiHistoryRef.current = [{ role: "assistant", content: response.content || [{ type: "text", text }] }];
      setChatLoading(false);
    };
    initCoach();
  }, [ready, profile]);

  // ── Recurrence detection ──────────────────────────────────────────────
  const recurringTodos = useMemo(() => {
    const counts = {};
    otherTodos.forEach(t => {
      const key = t.title.toLowerCase().trim();
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).filter(([, c]) => c >= 3).map(([title, count]) => ({ title, count }));
  }, [otherTodos]);

  // ── Computed ───────────────────────────────────────────────────────────
  const todayTasks = dailyBig3.filter(t => t.date === today());
  const todayDone = todayTasks.filter(t => t.done).length;
  const weekTasks = weeklyTasks.filter(t => t.weekId === getWeekId());
  const qMilestones = quarters.filter(q => q.quarter === getQ());
  const todayTodos = otherTodos.filter(t => t.date === today());
  const hasDumpedToday = mindDump.date === today();

  const buildContext = () => ({
    goals, quarters: qMilestones, weeklyTasks: weekTasks, todayTasks, otherTodos: todayTodos, streak: streaks.daily, journal,
  });

  // ── Tool Executor ───────────────────────────────────────────────────
  const executeTool = useCallback((toolName, toolInput) => {
    if (!toolInput || typeof toolInput !== "object") {
      return { success: false, error: "Invalid tool input" };
    }

    switch (toolName) {
      case "add_goal": {
        const goal = {
          id: uid(),
          title: toolInput.title,
          why: toolInput.why || "",
          smpieces: toolInput.smpieces || ""
        };
        setGoals(prev => [...prev, goal]);
        pendingGoalIds.current.add(goal.id);
        return { success: true, goalId: goal.id, message: `Goal created: ${goal.title}` };
      }

      case "add_milestone": {
        const goalExists = goals.some(g => g.id === toolInput.goalId) || pendingGoalIds.current.has(toolInput.goalId);
        if (!goalExists) {
          return { success: false, error: `No goal found with ID ${toolInput.goalId}. Available goals: ${goals.map(g => `${g.id} ("${g.title}")`).join(", ")}` };
        }
        const ms = {
          id: uid(),
          goalId: toolInput.goalId,
          milestone: toolInput.milestone,
          quarter: toolInput.quarter || getQ(),
          done: false
        };
        setQuarters(prev => [...prev, ms]);
        return { success: true, milestoneId: ms.id, message: `Milestone added: ${ms.milestone}` };
      }

      case "add_weekly_outcome": {
        const wo = {
          id: uid(),
          title: toolInput.title,
          weekId: toolInput.weekId || getWeekId(),
          done: false
        };
        setWeeklyTasks(prev => [...prev, wo]);
        return { success: true, outcomeId: wo.id, message: `Weekly outcome added: ${wo.title}` };
      }

      case "add_big3": {
        const targetDate = toolInput.date || today();
        const existing = dailyBig3.filter(t => t.date === targetDate);
        if (existing.length >= 3) {
          return {
            success: false,
            error: `Big 3 is full for ${targetDate}. Current Big 3: ${existing.map(t => t.title).join(", ")}. Ask the user which one to replace, or add to Other To-Dos instead.`
          };
        }
        const task = {
          id: uid(),
          title: toolInput.title,
          date: targetDate,
          done: false
        };
        setDailyBig3(prev => [...prev, task]);
        return { success: true, taskId: task.id, remaining: 3 - existing.length - 1, message: `Big 3 task added: ${task.title} (${3 - existing.length - 1} slot${3 - existing.length - 1 !== 1 ? "s" : ""} remaining)` };
      }

      case "add_todo": {
        const todo = {
          id: uid(),
          title: toolInput.title,
          date: toolInput.date || today(),
          done: false
        };
        setOtherTodos(prev => [...prev, todo]);
        return { success: true, todoId: todo.id, message: `To-do added: ${todo.title}` };
      }

      case "complete_task": {
        const { taskId, taskType } = toolInput;
        const setterMap = { big3: setDailyBig3, todo: setOtherTodos, weekly: setWeeklyTasks, milestone: setQuarters };
        const listMap = { big3: dailyBig3, todo: otherTodos, weekly: weeklyTasks, milestone: quarters };
        const setter = setterMap[taskType];
        if (!setter) {
          return { success: false, error: `Unknown task type: ${taskType}. Valid types: big3, todo, weekly, milestone` };
        }
        const task = listMap[taskType]?.find(t => t.id === taskId);
        if (!task) {
          return { success: false, error: `Task ${taskId} not found in ${taskType} list` };
        }
        setter(prev => prev.map(t => t.id === taskId ? { ...t, done: true } : t));
        return { success: true, message: `Completed: ${task.title || task.milestone}` };
      }

      case "add_reflection": {
        const entry = {
          id: uid(),
          text: toolInput.text,
          date: today(),
          type: toolInput.type || "reflection"
        };
        setJournal(prev => [...prev, entry]);
        return { success: true, entryId: entry.id, message: `Reflection saved` };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }, [goals, dailyBig3, otherTodos, weeklyTasks, quarters]);

  // ── Chat Handler (Agentic Loop) ──────────────────────────────────────
  const sendChat = async (text) => {
    if (!text?.trim()) return;
    const userMsg = { role: "user", content: text.trim() };

    // Update display chat
    setChatMsgs(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    pendingGoalIds.current.clear();

    // Track all tool actions taken during this exchange
    const toolActions = [];

    try {
      const ctx = buildContext();

      // Build API conversation from history + new message
      let conversationMsgs = [...apiHistoryRef.current, userMsg];

      let loopCount = 0;
      const MAX_LOOPS = 10; // Safety valve

      while (loopCount < MAX_LOOPS) {
        loopCount++;
        const response = await callClaude(conversationMsgs, profile, ctx);

        // Extract text and tool_use blocks from response
        const contentBlocks = response.content || [];
        const textBlocks = contentBlocks.filter(b => b.type === "text");
        const toolUseBlocks = contentBlocks.filter(b => b.type === "tool_use");

        if (toolUseBlocks.length === 0) {
          // No tool calls. We're done. Add final text to display chat.
          const finalText = textBlocks.map(b => b.text).join("") || "";
          // Add assistant text message to API history
          conversationMsgs = [...conversationMsgs, { role: "assistant", content: contentBlocks }];

          const displayMsg = {
            role: "assistant",
            content: finalText,
            toolActions: toolActions.length > 0 ? [...toolActions] : undefined
          };
          setChatMsgs(prev => [...prev, displayMsg]);
          break;
        }

        // There are tool calls. Add the full assistant response to API conversation
        // (preserving array content with tool_use blocks for API context)
        conversationMsgs = [...conversationMsgs, { role: "assistant", content: contentBlocks }];

        // Execute each tool and build tool_result blocks
        const toolResultBlocks = [];
        for (const toolUse of toolUseBlocks) {
          const result = executeTool(toolUse.name, toolUse.input);
          toolActions.push({
            tool: toolUse.name,
            input: toolUse.input,
            result: result
          });
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        }

        // Add tool results as a user message (API requirement)
        conversationMsgs = [...conversationMsgs, { role: "user", content: toolResultBlocks }];
      }

      if (loopCount >= MAX_LOOPS) {
        setChatMsgs(prev => [...prev, {
          role: "assistant",
          content: "Something went wrong. Let's try that again.",
          toolActions: toolActions.length > 0 ? [...toolActions] : undefined
        }]);
      }

      // Save full conversation history for next call (trim to prevent token overflow)
      apiHistoryRef.current = conversationMsgs.slice(-40);

    } catch (e) {
      console.error("sendChat error:", e);
      setChatMsgs(prev => [...prev, {
        role: "assistant",
        content: "Connection lost. Try again."
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Mind Dump Handler ─────────────────────────────────────────────────
  const submitMindDump = async () => {
    if (!dumpText.trim()) return;
    haptic("MEDIUM");
    setMindDump({ text: dumpText.trim(), date: today() });
    setShowMindDump(false);

    // Send to coach for Big 3 distillation
    setTab("chat");
    const prompt = `Here's what's on my mind today:\n\n${dumpText.trim()}\n\nHelp me figure out what my Big 3 should be today. What actually matters most from all of this?`;
    setTimeout(() => sendChat(prompt), 300);
    setDumpText("");
  };

  // ── CRUD ──────────────────────────────────────────────────────────────
  const toggle = (setter, id) => {
    haptic("LIGHT");
    setter(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };
  const remove = (setter, id) => setter(prev => prev.filter(t => t.id !== id));

  const addBig3 = (title) => {
    if (todayTasks.length >= 3) return;
    setDailyBig3(prev => [...prev, { id: uid(), title, date: today(), done: false }]);
  };

  const addTodo = () => {
    if (!newTodo.trim()) return;
    setOtherTodos(prev => [...prev, { id: uid(), title: newTodo.trim(), date: today(), done: false }]);
    setNewTodo("");
    setShowAddTodo(false);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // ONBOARDING
  // ═══════════════════════════════════════════════════════════════════════
  const onboardSteps = [
    {
      q: "What should I call you?",
      sub: "First name is perfect.",
      field: "name",
      type: "text",
      placeholder: "Your name",
    },
    {
      q: (d) => `Nice to meet you, ${d.name}. What do you do?`,
      sub: "Your role or how you spend most of your time.",
      field: "role",
      type: "text",
      placeholder: "e.g. VP of Marketing, founder, student, parent",
    },
    {
      q: "What does your life look like right now?",
      sub: "This helps me understand your capacity and constraints.",
      field: "familyStage",
      type: "options",
      options: [
        { label: "Single, flexible schedule", value: "single_flexible" },
        { label: "In a relationship, no kids", value: "couple_no_kids" },
        { label: "Young kids at home", value: "young_kids" },
        { label: "Older kids / teens", value: "older_kids" },
        { label: "Empty nester", value: "empty_nester" },
        { label: "It's complicated", value: "complicated" },
      ],
    },
    {
      q: "How much focused time do you realistically have each day?",
      sub: "Not total work hours. Deep, focused, uninterrupted time.",
      field: "timeAvailable",
      type: "options",
      options: [
        { label: "1-2 hours", value: "1-2h" },
        { label: "3-4 hours", value: "3-4h" },
        { label: "5-6 hours", value: "5-6h" },
        { label: "6+ hours", value: "6+h" },
      ],
    },
    {
      q: "When are you at your sharpest?",
      sub: "I'll use this to help you protect your peak hours.",
      field: "energyPattern",
      type: "options",
      options: [
        { label: "Early morning (5-9am)", value: "early_morning" },
        { label: "Mid-morning (9am-12pm)", value: "mid_morning" },
        { label: "Afternoon (12-5pm)", value: "afternoon" },
        { label: "Evening (5-10pm)", value: "evening" },
        { label: "Night owl (10pm+)", value: "night" },
      ],
    },
    {
      q: "Anything else I should know?",
      sub: "Anything that helps me understand what you're working toward. Optional.",
      field: "context",
      type: "textarea",
      placeholder: "e.g. Working toward a promotion, trying to lose 20 lbs, want more time with my kid...",
      optional: true,
    },
  ];

  const finishOnboarding = () => {
    haptic("HEAVY");
    const p = { ...onboardData, createdAt: today() };
    setProfile(p);
  };

  if (!ready) {
    return (
      <div style={S.loading}>
        <div style={S.loadingMark}>FF</div>
        <div style={S.loadingSub}>FOCUSFLOW</div>
      </div>
    );
  }

  // ── Onboarding Screen ─────────────────────────────────────────────────
  if (!profile) {
    const step = onboardSteps[onboardStep];
    const question = typeof step.q === "function" ? step.q(onboardData) : step.q;
    const canNext = step.optional || onboardData[step.field]?.trim?.()?.length > 0 || onboardData[step.field]?.length > 0;
    const isLast = onboardStep === onboardSteps.length - 1;

    return (
      <div style={S.onboard}>
        <div style={S.onboardProgress}>
          {onboardSteps.map((_, i) => (
            <div key={i} style={{ ...S.progressDot, ...(i <= onboardStep ? S.progressDotActive : {}) }} />
          ))}
        </div>
        <div style={S.onboardCard}>
          <h2 style={S.onboardQ}>{question}</h2>
          <p style={S.onboardSub}>{step.sub}</p>

          {step.type === "text" && (
            <input
              style={S.onboardInput}
              placeholder={step.placeholder}
              value={onboardData[step.field]}
              onChange={e => setOnboardData({ ...onboardData, [step.field]: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter" && canNext) { isLast ? finishOnboarding() : setOnboardStep(s => s + 1); } }}
              autoFocus
            />
          )}

          {step.type === "options" && (
            <div style={S.optionsList}>
              {step.options.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setOnboardData({ ...onboardData, [step.field]: opt.value })}
                  style={{ ...S.optionBtn, ...(onboardData[step.field] === opt.value ? S.optionBtnActive : {}) }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {step.type === "textarea" && (
            <textarea
              style={{ ...S.onboardInput, minHeight: 120, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              placeholder={step.placeholder}
              value={onboardData[step.field]}
              onChange={e => setOnboardData({ ...onboardData, [step.field]: e.target.value })}
              autoFocus
            />
          )}
        </div>
        <div style={S.onboardNav}>
          {onboardStep > 0 && (
            <button onClick={() => setOnboardStep(s => s - 1)} style={S.backBtn}>Back</button>
          )}
          <button
            onClick={() => { haptic("LIGHT"); isLast ? finishOnboarding() : setOnboardStep(s => s + 1); }}
            disabled={!canNext}
            style={{ ...S.nextBtn, opacity: canNext ? 1 : 0.3 }}
          >
            {isLast ? "Start" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TAB: TODAY
  // ═══════════════════════════════════════════════════════════════════════
  const renderToday = () => (
    <div style={S.page}>
      <div style={S.pageHead}>
        <div style={S.dateRow}>
          <span style={S.dateLabel}>{fmtDate(today())}</span>
                  </div>
        <h1 style={S.pageTitle}>Today</h1>
      </div>

      {/* Mind Dump CTA */}
      {!hasDumpedToday && todayTasks.length === 0 && (
        <button onClick={() => { setShowMindDump(true); setDumpText(""); }} style={S.mindDumpCta}>
          <div style={S.mindDumpIcon}>{I.brain}</div>
          <div>
            <div style={S.mindDumpTitle}>What's on your mind today?</div>
            <div style={S.mindDumpSub}>Get it out of your head. I'll sort it.</div>
          </div>
        </button>
      )}

      {/* Mind Dump Modal */}
      {showMindDump && (
        <div style={S.modal}>
          <div style={S.modalSheet}>
            <h3 style={S.modalTitle}>Clear your head</h3>
            <p style={S.modalSub}>Everything on your mind. Don't edit yourself.</p>
            <textarea
              style={S.textarea}
              placeholder="Meetings, deadlines, ideas, that thing you keep postponing..."
              value={dumpText}
              onChange={e => setDumpText(e.target.value)}
              rows={6}
              autoFocus
            />
            <div style={S.modalBtns}>
              <button onClick={() => setShowMindDump(false)} style={S.cancelBtn}>Cancel</button>
              <button onClick={submitMindDump} style={S.confirmBtn}>Find my priorities</button>
            </div>
          </div>
        </div>
      )}

      {/* Big 3 Section */}
      <div style={S.section}>
        <div style={S.sectionHead}>
          <h2 style={S.sectionTitle}>Big 3</h2>
          {todayTasks.length > 0 && (
            <span style={S.progressLabel}>{todayDone}/{todayTasks.length}</span>
          )}
        </div>

        {todayTasks.length > 0 && (
          <div style={S.progressBar}>
            <div style={{ ...S.progressFill, width: `${(todayDone / todayTasks.length) * 100}%` }} />
          </div>
        )}

        <div style={S.taskList}>
          {todayTasks.map((task, i) => (
            <div key={task.id} style={{ ...S.taskCard, opacity: task.done ? 0.5 : 1 }}>
              <div style={S.taskNum}>{i + 1}</div>
              <button onClick={() => toggle(setDailyBig3, task.id)} style={{ ...S.chk, ...(task.done ? S.chkDone : {}) }}>
                {task.done && I.check}
              </button>
              <span style={{ ...S.taskTxt, ...(task.done ? S.taskTxtDone : {}) }}>{task.title}</span>
              <button onClick={() => remove(setDailyBig3, task.id)} style={S.delBtn}>{I.trash}</button>
            </div>
          ))}
        </div>

        {todayTasks.length < 3 && todayTasks.length > 0 && (
          <QuickAdd placeholder="Add to Big 3" onAdd={addBig3} />
        )}

        {todayTasks.length === 0 && hasDumpedToday && (
          <QuickAdd placeholder="What matters most today?" onAdd={addBig3} />
        )}
      </div>

      {/* Other To-Dos */}
      <div style={S.section}>
        <div style={S.sectionHead}>
          <h2 style={S.sectionTitle}>Other To-Dos</h2>
          <button onClick={() => setShowAddTodo(true)} style={S.addSmall}>{I.plus}</button>
        </div>

        {recurringTodos.length > 0 && (
          <div style={S.insightBar}>
            {I.repeat}
            <span style={S.insightText}>
              "{recurringTodos[0].title}" has come up {recurringTodos[0].count}+ times. Worth building a system for it?
            </span>
          </div>
        )}

        <div style={S.taskList}>
          {todayTodos.map(task => (
            <div key={task.id} style={{ ...S.todoCard, opacity: task.done ? 0.5 : 1 }}>
              <button onClick={() => toggle(setOtherTodos, task.id)} style={{ ...S.chkSmall, ...(task.done ? S.chkSmallDone : {}) }}>
                {task.done && I.check}
              </button>
              <span style={{ ...S.todoTxt, ...(task.done ? S.taskTxtDone : {}) }}>{task.title}</span>
              <button onClick={() => remove(setOtherTodos, task.id)} style={S.delBtn}>{I.trash}</button>
            </div>
          ))}
        </div>

        {showAddTodo && (
          <div style={S.inlineAdd}>
            <input
              style={S.inlineInput}
              placeholder="Add a to-do"
              value={newTodo}
              onChange={e => setNewTodo(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addTodo(); if (e.key === "Escape") setShowAddTodo(false); }}
              autoFocus
            />
          </div>
        )}

        {todayTodos.length === 0 && !showAddTodo && (
          <button onClick={() => setShowAddTodo(true)} style={S.addBtn}>
            {I.plus}
          </button>
        )}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // TAB: GOALS
  // ═══════════════════════════════════════════════════════════════════════
  const renderGoals = () => (
    <div style={S.page}>
      <div style={S.pageHead}>
        <h1 style={S.pageTitle}>Goals</h1>
      </div>

      {/* Annual Goals */}
      {goals.length === 0 ? (
        <div style={S.empty}>
          <div style={S.emptyIcon}>{I.target}</div>
          <p style={S.emptyTxt}>No goals set. Talk to your coach to get started.</p>
          <button onClick={() => setTab("chat")} style={S.confirmBtn}>Open Coach</button>
        </div>
      ) : (
        <div style={S.goalList}>
          {goals.map(g => {
            const ms = quarters.filter(q => q.goalId === g.id);
            const done = ms.filter(q => q.done).length;
            return (
              <div key={g.id} style={S.goalCard}>
                <div style={S.goalTop}>
                  <h3 style={S.goalTitle}>{g.title}</h3>
                  <button onClick={() => remove(setGoals, g.id)} style={S.delBtn}>{I.trash}</button>
                </div>
                {g.why && <p style={S.goalWhy}>Why: {g.why}</p>}
                {g.smpieces && <p style={S.goalMeta}>{g.smpieces}</p>}
                {ms.length > 0 && (
                  <div style={S.msMini}>
                    <span style={S.msCount}>{done}/{ms.length} milestones this quarter</span>
                    <div style={S.miniBar}><div style={{ ...S.miniFill, width: `${ms.length ? (done / ms.length) * 100 : 0}%` }} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button onClick={() => { setTab("chat"); setTimeout(() => sendChat("I want to set a new annual goal. Help me make it SMARTER."), 500); }} style={S.addBtn}>
        {I.plus} <span>New goal</span>
      </button>

      {/* Quarterly Milestones */}
      <div style={{ ...S.sectionHead, marginTop: 32 }}>
        <h2 style={S.sectionTitle}>{getQ()} Milestones</h2>
      </div>

      {qMilestones.length === 0 ? (
        <p style={S.emptySmall}>No milestones this quarter.</p>
      ) : (
        <div style={S.taskList}>
          {qMilestones.map(q => (
            <div key={q.id} style={S.taskCard}>
              <button onClick={() => toggle(setQuarters, q.id)} style={{ ...S.chk, ...(q.done ? S.chkDone : {}) }}>
                {q.done && I.check}
              </button>
              <div style={{ flex: 1 }}>
                <span style={{ ...S.taskTxt, ...(q.done ? S.taskTxtDone : {}) }}>{q.milestone}</span>
                {goals.find(g => g.id === q.goalId) && <span style={S.tag}>{goals.find(g => g.id === q.goalId)?.title}</span>}
              </div>
              <button onClick={() => remove(setQuarters, q.id)} style={S.delBtn}>{I.trash}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // TAB: WEEK
  // ═══════════════════════════════════════════════════════════════════════
  const renderWeek = () => (
    <div style={S.page}>
      <div style={S.pageHead}>
        <h1 style={S.pageTitle}>Weekly Preview</h1>
        <p style={S.pageSub}>{getWeekId().replace("-", " · ")}</p>
      </div>

      {weekTasks.length === 0 ? (
        <div style={S.empty}>
          <div style={S.emptyIcon}>{I.cal}</div>
          <p style={S.emptyTxt}>No outcomes set for this week.</p>
        </div>
      ) : (
        <div style={S.taskList}>
          {weekTasks.map(t => (
            <div key={t.id} style={S.taskCard}>
              <button onClick={() => toggle(setWeeklyTasks, t.id)} style={{ ...S.chk, ...(t.done ? S.chkDone : {}) }}>
                {t.done && I.check}
              </button>
              <span style={{ ...S.taskTxt, ...(t.done ? S.taskTxtDone : {}) }}>{t.title}</span>
              <button onClick={() => remove(setWeeklyTasks, t.id)} style={S.delBtn}>{I.trash}</button>
            </div>
          ))}
        </div>
      )}

      <QuickAdd placeholder="Add an outcome" onAdd={(title) => setWeeklyTasks(prev => [...prev, { id: uid(), title, weekId: getWeekId(), done: false }])} />
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // TAB: COACH (Chat)
  // ═══════════════════════════════════════════════════════════════════════
  const renderChat = () => (
    <div style={S.chatWrap}>
      <div style={S.chatHead}>
        <div style={S.chatAvBig}>{I.spark}</div>
        <div>
          <div style={S.chatName}>FocusFlow Coach</div>
          <div style={S.chatStatus}>{chatLoading ? "Thinking..." : ""}</div>
        </div>
      </div>

      <div style={S.chatBody}>
        {chatMsgs.map((m, i) => (
          <div key={i} style={m.role === "assistant" ? S.aiRow : S.userRow}>
            {m.role === "assistant" && <div style={S.aiAv}>{I.spark}</div>}
            <div style={{ maxWidth: "85%" }}>
              {/* Action badges - show what tools the coach called */}
              {m.toolActions && m.toolActions.length > 0 && (
                <div style={S.actionBadges}>
                  {m.toolActions.filter(a => a.result.success).map((a, j) => (
                    <div key={j} style={S.actionBadge}>
                      {"✓ "}{a.result.message}
                    </div>
                  ))}
                </div>
              )}
              {/* Text content */}
              {m.content && (
                <div style={m.role === "assistant" ? S.aiBub : S.userBub}>
                  {m.content}
                </div>
              )}
            </div>
          </div>
        ))}
        {chatLoading && (
          <div style={S.aiRow}>
            <div style={S.aiAv}>{I.spark}</div>
            <div style={S.aiBub}>
              <span style={S.typing}>
                <span style={S.dot1}>.</span><span style={S.dot2}>.</span><span style={S.dot3}>.</span>
              </span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={S.chatBar}>
        <input
          ref={chatInputRef}
          style={S.chatIn}
          placeholder="Message your coach"
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !chatLoading) sendChat(chatInput); }}
        />
        <button onClick={() => !chatLoading && sendChat(chatInput)} style={{ ...S.sendBtn, opacity: chatLoading ? 0.4 : 1 }}>
          {I.arrow}
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div style={S.app}>
      <div style={S.content}>
        {tab === "today" && renderToday()}
        {tab === "goals" && renderGoals()}
        {tab === "week" && renderWeek()}
        {tab === "chat" && renderChat()}
      </div>

      <nav style={S.nav}>
        {[
          { id: "today", icon: I.sun, label: "Today" },
          { id: "week", icon: I.cal, label: "Week" },
          { id: "goals", icon: I.target, label: "Goals" },
          { id: "chat", icon: I.chat, label: "Coach" },
        ].map(item => (
          <button key={item.id} onClick={() => setTab(item.id)} style={{ ...S.navBtn, ...(tab === item.id ? S.navActive : {}) }}>
            <span style={tab === item.id ? S.navIcoA : S.navIco}>{item.icon}</span>
            <span style={tab === item.id ? S.navLblA : S.navLbl}>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK ADD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
function QuickAdd({ placeholder, onAdd, remaining }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const submit = () => { if (val.trim()) { onAdd(val.trim()); setVal(""); setOpen(false); } };
  if (!open) return (
    <button onClick={() => setOpen(true)} style={S.addBtn}>
      {I.plus} <span>{placeholder}</span>
    </button>
  );
  return (
    <div style={S.inlineAdd}>
      <input
        style={S.inlineInput}
        placeholder={placeholder}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
        autoFocus
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════
const gold = "#D4A853";
const bg = "#0C0C12";
const card = "#14141F";
const border = "#1C1C2E";
const txt = "#E2DFDA";
const sub = "#6B6B7B";
const S = {
  app: { fontFamily: "-apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif", background: bg, color: txt, minHeight: "100vh", maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column" },
  content: { flex: 1, overflowY: "auto", paddingBottom: 80 },

  // Loading
  loading: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: bg, gap: 10 },
  loadingMark: { fontSize: 36, fontWeight: 800, color: gold, letterSpacing: 6, animation: "pulse 2s ease-in-out infinite" },
  loadingSub: { fontSize: 11, color: sub, letterSpacing: 4 },

  // Onboarding
  onboard: { display: "flex", flexDirection: "column", minHeight: "100vh", background: bg, padding: "60px 24px 40px", justifyContent: "space-between" },
  onboardProgress: { display: "flex", gap: 6, marginBottom: 60 },
  progressDot: { height: 3, flex: 1, borderRadius: 3, background: "#222" },
  progressDotActive: { background: gold },
  onboardCard: { flex: 1 },
  onboardQ: { fontSize: 26, fontWeight: 700, lineHeight: 1.3, margin: "0 0 10px", color: "#F2F0EB" },
  onboardSub: { fontSize: 14, color: sub, margin: "0 0 30px", lineHeight: 1.5 },
  onboardInput: { width: "100%", padding: "16px 18px", fontSize: 17, background: card, border: `1px solid ${border}`, borderRadius: 14, color: txt, outline: "none", boxSizing: "border-box" },
  optionsList: { display: "flex", flexDirection: "column", gap: 10 },
  optionBtn: { padding: "15px 18px", background: card, border: `1px solid ${border}`, borderRadius: 14, color: txt, fontSize: 15, textAlign: "left", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)" },
  optionBtnActive: { borderColor: gold, background: `${gold}10` },
  onboardNav: { display: "flex", gap: 12, marginTop: 40 },
  backBtn: { padding: "14px 24px", background: "transparent", border: `1px solid #333`, borderRadius: 14, color: sub, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  nextBtn: { flex: 1, padding: "14px 24px", background: gold, border: "none", borderRadius: 14, color: "#0C0C12", fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)" },

  // Page
  page: { padding: "24px 20px" },
  pageHead: { marginBottom: 20 },
  dateRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 },
  dateLabel: { fontSize: 12, color: sub, letterSpacing: 1.5, textTransform: "uppercase" },
  pageTitle: { fontSize: 28, fontWeight: 700, margin: 0, color: "#F2F0EB", letterSpacing: -0.5 },
  pageSub: { fontSize: 14, color: sub, margin: "5px 0 0" },

  // Mind Dump CTA
  mindDumpCta: { display: "flex", alignItems: "center", gap: 16, width: "100%", padding: "18px 20px", background: `linear-gradient(135deg, ${gold}08, ${gold}15)`, border: `1px solid ${gold}30`, borderRadius: 18, cursor: "pointer", textAlign: "left", marginBottom: 24 },
  mindDumpIcon: { color: gold, flexShrink: 0, opacity: 0.8 },
  mindDumpTitle: { fontSize: 16, fontWeight: 600, color: "#F2F0EB", marginBottom: 3 },
  mindDumpSub: { fontSize: 13, color: sub, lineHeight: 1.4 },

  // Sections
  section: { marginBottom: 28 },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: 600, margin: 0, color: "#F2F0EB" },
  progressLabel: { fontSize: 13, color: sub, fontWeight: 500 },

  // Progress bar
  progressBar: { height: 2, background: "#1A1A2A", borderRadius: 2, marginBottom: 14, overflow: "hidden" },
  progressFill: { height: "100%", background: `linear-gradient(90deg, ${gold}, #C49530)`, borderRadius: 2, transition: "width 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)" },

  // Tasks
  taskList: { display: "flex", flexDirection: "column", gap: 6 },
  taskCard: { display: "flex", alignItems: "center", gap: 12, background: card, borderRadius: 14, padding: "13px 16px", border: `1px solid ${border}`, transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)" },
  taskNum: { width: 22, height: 22, borderRadius: 7, background: `${gold}12`, color: gold, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chk: { width: 24, height: 24, borderRadius: 8, border: "2px solid #333", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", padding: 0, transition: "all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)" },
  chkDone: { background: gold, borderColor: gold, color: bg },
  taskTxt: { flex: 1, fontSize: 15, lineHeight: 1.4, color: "#DDD9D2" },
  taskTxtDone: { textDecoration: "line-through", color: "#444" },
  delBtn: { background: "transparent", border: "none", color: "#333", cursor: "pointer", padding: 4, display: "flex", opacity: 0.5 },

  // Todos
  todoCard: { display: "flex", alignItems: "center", gap: 10, background: card, borderRadius: 12, padding: "11px 14px", border: `1px solid ${border}` },
  chkSmall: { width: 20, height: 20, borderRadius: 6, border: "2px solid #333", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", padding: 0 },
  chkSmallDone: { background: "#4A9D6E", borderColor: "#4A9D6E", color: "#fff" },
  todoTxt: { flex: 1, fontSize: 14, color: "#CCC8C0" },

  // Insight bar
  insightBar: { display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: `${gold}08`, border: `1px solid ${gold}20`, borderRadius: 12, marginBottom: 10, color: gold },
  insightText: { fontSize: 13, color: "#B8A86A", lineHeight: 1.3 },

  // Buttons
  addBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "13px 20px", marginTop: 12, background: `${gold}08`, border: `1px dashed ${gold}30`, borderRadius: 14, color: gold, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  addSmall: { width: 28, height: 28, borderRadius: 8, background: `${gold}10`, border: "none", color: gold, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 },
  cancelBtn: { flex: 1, padding: 14, background: "transparent", border: `1px solid #333`, borderRadius: 12, color: sub, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  confirmBtn: { flex: 1, padding: 14, background: gold, border: "none", borderRadius: 12, color: bg, fontSize: 14, fontWeight: 700, cursor: "pointer" },

  // Inline add
  inlineAdd: { marginTop: 8 },
  inlineInput: { width: "100%", padding: "12px 16px", fontSize: 14, background: card, border: `1px solid ${border}`, borderRadius: 12, color: txt, outline: "none", boxSizing: "border-box" },

  // Goals
  goalList: { display: "flex", flexDirection: "column", gap: 12 },
  goalCard: { background: card, borderRadius: 16, padding: "18px 20px", border: `1px solid ${border}` },
  goalTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  goalTitle: { fontSize: 17, fontWeight: 600, margin: 0, color: "#F2F0EB" },
  goalWhy: { fontSize: 13, color: "#8A8A9A", margin: "6px 0 0", lineHeight: 1.4, fontStyle: "italic" },
  goalMeta: { fontSize: 12, color: sub, margin: "4px 0 0" },
  tag: { display: "inline-block", fontSize: 11, color: gold, background: `${gold}10`, padding: "2px 8px", borderRadius: 6, marginTop: 4 },
  msMini: { marginTop: 12 },
  msCount: { fontSize: 12, color: sub },
  miniBar: { height: 2, background: "#1A1A2A", borderRadius: 2, marginTop: 6, overflow: "hidden" },
  miniFill: { height: "100%", background: gold, borderRadius: 2, transition: "width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)" },

  // Empty
  empty: { display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", textAlign: "center", gap: 16 },
  emptyIcon: { color: "#333", transform: "scale(2)" },
  emptyTxt: { fontSize: 15, color: "#555", lineHeight: 1.5, maxWidth: 280 },
  emptySmall: { fontSize: 13, color: "#444", textAlign: "center", padding: "16px 0" },

  // Modal
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" },
  modalSheet: { background: "#18182A", borderRadius: "24px 24px 0 0", padding: "28px 24px 36px", width: "100%", maxWidth: 430, display: "flex", flexDirection: "column", gap: 14 },
  modalTitle: { fontSize: 20, fontWeight: 700, margin: 0, color: "#F2F0EB" },
  modalSub: { fontSize: 14, color: sub, margin: "-8px 0 0", lineHeight: 1.4 },
  modalBtns: { display: "flex", gap: 10, marginTop: 4 },
  textarea: { width: "100%", padding: "14px 16px", fontSize: 15, background: bg, border: `1px solid ${border}`, borderRadius: 14, color: txt, outline: "none", boxSizing: "border-box", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit", minHeight: 120 },

  // Chat
  chatWrap: { display: "flex", flexDirection: "column", height: "calc(100vh - 80px)" },
  chatHead: { display: "flex", alignItems: "center", gap: 12, padding: "20px 20px 14px", borderBottom: `1px solid ${border}` },
  chatAvBig: { width: 40, height: 40, borderRadius: 12, background: `${gold}12`, color: gold, display: "flex", alignItems: "center", justifyContent: "center" },
  chatName: { fontSize: 16, fontWeight: 600, color: "#F2F0EB" },
  chatStatus: { fontSize: 12, color: sub },
  chatBody: { flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 },
  aiRow: { display: "flex", gap: 10, alignItems: "flex-start" },
  userRow: { display: "flex", justifyContent: "flex-end" },
  aiAv: { width: 26, height: 26, borderRadius: 8, background: `${gold}12`, color: gold, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },
  aiBub: { background: card, borderRadius: "4px 16px 16px 16px", padding: "12px 16px", fontSize: 14, lineHeight: 1.6, color: "#CCC8C0", maxWidth: "85%", border: `1px solid ${border}` },
  userBub: { background: gold, borderRadius: "16px 4px 16px 16px", padding: "12px 16px", fontSize: 14, lineHeight: 1.5, color: bg, maxWidth: "85%", fontWeight: 500 },
  actionBadges: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 },
  actionBadge: { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: `${gold}15`, border: `1px solid ${gold}30`, borderRadius: 10, fontSize: 12, fontWeight: 600, color: gold, lineHeight: 1.3 },
  chatBar: { display: "flex", gap: 10, padding: "12px 20px 20px", borderTop: `1px solid ${border}` },
  chatIn: { flex: 1, padding: "13px 16px", fontSize: 15, background: card, border: `1px solid ${border}`, borderRadius: 14, color: txt, outline: "none", fontFamily: "inherit" },
  sendBtn: { width: 46, height: 46, borderRadius: 14, background: gold, border: "none", color: bg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)" },

  // Typing indicator
  typing: { display: "flex", gap: 3, alignItems: "center" },
  dot1: { animation: "bounce 1.4s infinite", color: sub, fontSize: 24, lineHeight: 0 },
  dot2: { animation: "bounce 1.4s infinite 0.2s", color: sub, fontSize: 24, lineHeight: 0 },
  dot3: { animation: "bounce 1.4s infinite 0.4s", color: sub, fontSize: 24, lineHeight: 0 },

  // Nav
  nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, display: "flex", justifyContent: "space-around", padding: "10px 0 calc(22px + env(safe-area-inset-bottom, 0px))", background: `linear-gradient(to top, ${bg} 75%, transparent)`, borderTop: `1px solid ${border}`, zIndex: 50 },
  navBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "transparent", border: "none", cursor: "pointer", padding: "6px 16px", borderRadius: 12, transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)" },
  navActive: { background: `${gold}08` },
  navIco: { color: "#444" },
  navIcoA: { color: gold },
  navLbl: { fontSize: 11, fontWeight: 500, color: "#444", letterSpacing: 0.3 },
  navLblA: { fontSize: 11, fontWeight: 600, color: gold, letterSpacing: 0.3 },
};
