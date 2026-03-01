# FocusFlow

## What This Is

FocusFlow is a mobile-first iOS app that combines the Full Focus Planner system with a Rosebud-style conversational AI coach. The core idea: instead of filling out forms and checking boxes, you talk to an AI coach that manages your goals, tasks, and reflections through conversation, then automatically puts everything in the right place.

Think of it as: Full Focus Planner structure + Rosebud conversational UX + Claude as the engine.

## Tech Stack

- **Framework:** React Native with Expo (not a PWA, not a web wrapper)
- **AI:** Claude API (Sonnet) with tool use for agentic actions
- **Storage:** AsyncStorage for persistent local data
- **Notifications:** Expo Notifications for push reminders
- **Distribution:** iOS App Store via EAS Build

### Why React Native + Expo (not PWA)

PWAs on iOS are second-class citizens. Apple limits push notifications, offline support is weak, and the App Store review team rejects PWA wrappers. React Native with Expo gives native performance, real push notifications, proper offline storage, and a clean App Store submission. Codebase is 90% shareable if Android is ever needed.

## Architecture

### The Coach Is the Primary Interface

The AI Coach is NOT a sidebar feature. It is the main way users interact with the app. When the coach and user agree on a goal, task, or weekly outcome in conversation, the coach calls a tool and it appears in the correct tab automatically. Zero double entry.

### Claude Tool Use (Critical)

The coach uses Claude's tool use API with these tools:

- `add_goal` - Creates an annual goal (after SMARTER refinement)
- `add_milestone` - Creates a quarterly milestone linked to a goal
- `add_weekly_outcome` - Adds a weekly outcome
- `add_big3` - Adds a task to today's Big 3 (hard cap at 3)
- `add_todo` - Adds an item to the Other To-Dos list
- `complete_task` - Marks a task as done
- `add_reflection` - Stores a journal/reflection entry

**CRITICAL IMPLEMENTATION NOTE:** The coach must ACTUALLY CALL the tools via the API's tool_use content blocks. It must NOT generate text that describes using tools. The system prompt must be explicit: "You MUST use the provided tools to add goals, tasks, and milestones. Never describe adding them in text. Always call the tool."

### Agentic Loop

The app implements an agentic loop for multi-step tool use:

1. User sends message
2. App calls Claude API with tools defined
3. If response contains `tool_use` blocks, execute each tool and update app state
4. Send `tool_result` messages back to Claude
5. Repeat until Claude responds with only text (stop_reason: end_turn with no tool_use)
6. Display final text response to user

**Known pitfall:** Messages with array content (tool_use and tool_result) must be passed through as-is to the API. Do NOT filter them out or convert them to strings. The API requires the exact back-and-forth format: assistant message with tool_use array content, followed by user message with tool_result array content.

### Data Model

All data persists locally with separate storage keys:

- `profile` - User onboarding data (name, role, life stage, energy patterns, open-ended context)
- `goals` - Annual goals with SMARTER attributes
- `milestones` - Quarterly milestones linked to goal IDs
- `weekly` - Weekly outcomes with week number
- `daily` - Daily Big 3 tasks (max 3 per day)
- `todos` - Other to-dos with recurrence tracking
- `journal` - Reflections and brain dump entries
- `streaks` - Streak data (days with Big 3 set)
- `chat_history` - Last 50 messages for coach continuity

## App Structure

### Tab Order

Today > Week > Goals > Coach

This follows the daily-to-long-term hierarchy. Users spend most time in Today and Coach.

### Tab: Today

- Opens with a "What's on your mind today?" brain dump card if Big 3 is not set
- User writes everything on their mind, hits "Find my Big 3"
- App switches to Coach tab. Coach reads the dump, identifies priorities, and uses tools to set Big 3 and sort the rest into Other To-Dos
- User returns to Today tab. Everything is there.
- Big 3 section: Hard cap at 3. If user tries to add a 4th, coach pushes back and asks them to prioritize.
- Other To-Dos section: Items that don't tie to major goals. App tracks recurrence. If the same to-do appears 3+ times, surface an insight: "This keeps showing up. Time to make it a system?"
- Streak counter: Automatically increments each day the Big 3 is set

### Tab: Week

- Weekly outcomes for the current week
- Linked to quarterly milestones where applicable
- Coach can populate these through conversation

### Tab: Goals

- Annual goals with SMARTER attributes
- Quarterly milestones linked to each goal
- No manual goal creation form. Setting a goal always goes through the Coach for SMARTER refinement.

### Tab: Coach

- Full chat interface
- Contextual nudges based on time of day, what's set up, streaks, and system state
- Morning: push to set Big 3
- Evening: prompt reflection
- Missing structure: "You have goals but no quarterly milestones. Let's fix that."
- All goal setting, milestone creation, and weekly planning happens here through conversation

## Coach Behavior

### System Prompt Requirements

The coach system prompt must include:

- Full Focus Planner methodology (SMARTER goals, Big 3, weekly preview, quarterly review)
- User's profile data from onboarding
- Current goals, milestones, and active tasks
- Today's Big 3 status and streak count
- Recent reflections and journal entries
- Current date, day of week, and week number
- Instruction to ALWAYS use tools when adding/modifying data (never just describe it)

### SMARTER Goal Setting Flow

When user wants to set a goal, the coach walks them through:

- **S**pecific: What exactly do you want to achieve?
- **M**easurable: How will you know you've hit it?
- **A**ctionable: What actions are in your control?
- **R**isky: Does this stretch you? (Not reckless, but uncomfortable)
- **T**ime-keyed: By when?
- **E**xciting: Does this fire you up?
- **R**elevant: Does this connect to something you truly value?

The coach pushes back on vague goals. "Grow my business" gets challenged. It won't let a goal through until it's tight.

### Season of Life Awareness

The coach factors in the user's life stage, available time, and energy patterns when suggesting how to break down goals. A parent of young kids with 2 focused hours a day gets different quarterly milestones than someone with 6 hours.

### Cascading Breakdown

After an annual goal is set, the coach guides the user to create:
1. Quarterly milestones that are realistic checkpoints
2. Weekly outcomes that feed into the current quarter's milestone
3. Daily Big 3 tasks that move the needle on weekly outcomes

## Onboarding Flow

6 steps, conversational tone (not a boring form):

1. **Name** - "What should I call you?"
2. **Role** - "What do you do? Work, school, or something else?"
3. **Life stage** - "Tell me about your life right now. Family, commitments, what's on your plate."
4. **Focused time** - "How many hours of focused work can you realistically do in a day?"
5. **Energy patterns** - "When are you sharpest? Morning, afternoon, or evening?"
6. **Open-ended** - "Anything else I should know about you and what you're trying to achieve?" (textarea for whatever they want to share)

All of this feeds into the coach's system prompt for every conversation.

## Persistent Memory

The coach builds context over time, similar to Rosebud:

- Stores all reflections and journal entries
- Tracks goal progress and completion patterns
- Remembers what the user has shared about their life, challenges, and motivations
- Uses this history to give personalized nudges and insights
- Chat history (last 50 messages) persists between sessions

## Key Design Principles

1. **The coach has hands, not just a mouth.** It doesn't just talk about adding goals. It adds them.
2. **No double entry.** If you told the coach, it's in the system.
3. **Big 3 is sacred.** Hard cap at 3. The whole point is constraint.
4. **Other to-dos matter too.** Not everything ties to big goals. Capture it anyway.
5. **Recurrence is a signal.** If something keeps showing up, surface it.
6. **Brain dump first, organize second.** Start messy, let the coach sort it.
7. **Push back on vague.** The coach is a partner, not a yes-man.

## File Structure

```
focusflow/
├── app/                    # Expo Router screens
│   ├── (tabs)/
│   │   ├── today.tsx       # Daily Big 3 + brain dump + other to-dos
│   │   ├── week.tsx        # Weekly outcomes
│   │   ├── goals.tsx       # Annual goals + quarterly milestones
│   │   └── coach.tsx       # AI chat interface
│   ├── onboarding.tsx      # 6-step onboarding flow
│   └── _layout.tsx         # Tab navigation layout
├── components/
│   ├── BrainDumpCard.tsx   # "What's on your mind?" input
│   ├── Big3List.tsx        # Big 3 display with completion toggles
│   ├── TodoList.tsx        # Other to-dos with recurrence badges
│   ├── GoalCard.tsx        # Goal display with SMARTER attributes
│   ├── MilestoneCard.tsx   # Quarterly milestone display
│   ├── WeeklyCard.tsx      # Weekly outcome display
│   ├── ChatMessage.tsx     # Coach message bubble
│   ├── ActionBadge.tsx     # Gold badge showing tool actions in chat
│   └── StreakCounter.tsx   # Streak display
├── services/
│   ├── claude.ts           # Claude API client with tool use handling
│   ├── agenticLoop.ts      # Multi-step tool execution loop
│   ├── storage.ts          # AsyncStorage wrapper for all data
│   └── notifications.ts   # Expo push notification setup
├── tools/
│   ├── definitions.ts      # Tool schemas for Claude API
│   └── executor.ts         # Tool execution logic (updates app state)
├── hooks/
│   ├── useProfile.ts       # Profile data hook
│   ├── useGoals.ts         # Goals + milestones hook
│   ├── useDaily.ts         # Big 3 + to-dos hook
│   └── useCoach.ts         # Chat state + message handling hook
├── constants/
│   ├── prompts.ts          # System prompt builder
│   └── nudges.ts           # Time-based nudge templates
└── types/
    └── index.ts            # TypeScript types for all data models
```

## Common Pitfalls to Avoid

1. **Tool use text generation vs actual tool calls.** The #1 bug in development was Claude generating text like "I've added your goal" without actually calling the tool. The system prompt must be aggressive about this. Test by checking if items actually appear in tabs after coach conversation.

2. **Message filtering breaking the agentic loop.** Do NOT filter messages by content type before sending to the API. Tool use requires assistant messages with array content (tool_use blocks) and user messages with array content (tool_result blocks). Pass them through as-is.

3. **Context injection location.** Inject system context (goals, tasks, profile) into the system prompt, not into user messages. Keep the message array clean for the tool use flow.

4. **Streak counting edge cases.** A streak counts days where Big 3 was SET, not completed. Use date strings (YYYY-MM-DD) as keys, not timestamps.

5. **Storage key collisions.** Each data type gets its own storage key. Don't try to store everything in one giant object.
