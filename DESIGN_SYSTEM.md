# PrepWise Design System
## Modern, Premium, Minimal Interview Coaching Platform

---

## Core Philosophy

PrepWise is designed to feel **calm, intelligent, and trustworthy**. Like a patient AI coach that reduces anxiety, not increases it.

The design prioritizes:
- **Cognitive ease** — users never feel overwhelmed
- **Clear hierarchy** — important things look important
- **Human warmth** — technology that feels like a person supporting you
- **Purposeful minimalism** — every element earns its space
- **Visual confidence** — premium, not generic

---

## Color Palette

### Primary Brand Color
- **Primary Blue**: `#4F80FF` (confident, trustworthy, modern)
- **Primary Dark**: `#3D49BD` (for emphasis, darker interactions)
- **Primary Soft**: `#EEF0FF` (light backgrounds, hover states)

### Neutrals
- **Ink (Text)**: `#15223B` (very dark, readable)
- **Muted (Secondary Text)**: `#637089` (gray, lighter than ink)
- **Line (Borders)**: `#E5E9F0` (soft dividers)
- **Surface (Card BG)**: `#FFFFFF` or `#F9FAFC` (white, off-white)
- **Canvas (Page BG)**: `#F6F7FB` (soft, calming background)

### Semantic Colors
- **Success**: `#168866` (green, for positive feedback)
- **Warning**: `#B56822` (orange, for caution/improvement)
- **Info**: `#4F80FF` (blue, for information)
- **Error**: `#DC2626` (red, for errors)

### Gradients
- **Primary Gradient**: `linear-gradient(135deg, #4F80FF 0%, #7F8AF0 100%)` — soft, not aggressive
- **Dark Gradient** (for headers): `linear-gradient(135deg, #172554 0%, #263B86 100%)` — premium, reserved

---

## Typography

### Font Family
- **Primary**: Inter (system-ui, sans-serif)
- **Weights**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold)

### Type Scale

| Role | Size | Weight | Line Height | Letter Spacing | Use |
|------|------|--------|-------------|---|--|
| **Page Title** | 2.5rem | 800 | 1.1 | -0.02em | Main page headings |
| **Section Title** | 1.5rem | 700 | 1.2 | -0.01em | Major section headings |
| **Card Title** | 1.1rem | 700 | 1.3 | 0 | Card headers |
| **Body Large** | 1rem | 400 | 1.6 | 0 | Primary content |
| **Body Regular** | 0.95rem | 400 | 1.6 | 0 | Default text |
| **Body Small** | 0.875rem | 400 | 1.5 | 0 | Secondary content |
| **Label** | 0.75rem | 600 | 1.4 | 0.01em | Form labels, small info |
| **Caption** | 0.7rem | 500 | 1.4 | 0.02em | Tiny labels, hints |

---

## Spacing System

- `4px` — minimum spacing
- `8px` — tight spacing
- `12px` — close spacing
- `16px` — default spacing
- `20px` — comfortable spacing
- `24px` — section spacing
- `32px` — large section spacing
- `48px` — page section spacing

Rule: **Use larger spacing than you think.** Whitespace is not wasted space—it reduces cognitive load.

---

## Components

### Cards

```css
.card {
  background: white;
  border: 1px solid #E5E9F0;
  border-radius: 1rem;
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(21, 34, 59, 0.02),
              0 8px 16px rgba(21, 34, 59, 0.04);
  transition: all 0.2s ease;
}

.card:hover {
  box-shadow: 0 1px 3px rgba(21, 34, 59, 0.03),
              0 12px 24px rgba(21, 34, 59, 0.06);
}
```

**Behavior**: Cards should be subtle, not demanding. Soft shadows, clean borders, light backgrounds.

### Buttons

**Primary Button**:
```css
.btn-primary {
  background: #4F80FF;
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 0.95rem;
  border: none;
  box-shadow: 0 4px 12px rgba(79, 128, 255, 0.2);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: #3D49BD;
  box-shadow: 0 8px 20px rgba(79, 128, 255, 0.25);
  transform: translateY(-1px);
}
```

**Secondary Button**:
```css
.btn-secondary {
  background: white;
  color: #637089;
  border: 1px solid #E5E9F0;
  padding: 0.75rem 1.5rem;
  border-radius: 0.75rem;
  font-weight: 600;
  font-size: 0.95rem;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: #F9FAFC;
  border-color: #CBD5E1;
  color: #15223B;
}
```

### Forms

- **Input**: White background, soft border (#E5E9F0), rounded 0.75rem
- **Focus State**: Border → #4F80FF, shadow 0 0 0 3px rgba(79, 128, 255, 0.1)
- **Label**: Color #637089, font-weight 600, size 0.875rem
- **Hint Text**: Color #94A3B8, size 0.75rem, weight 400

### Icons

- **Size**: 16px, 20px, 24px (consistent with content size)
- **Color**: Inherit from parent text color by default
- **Margin**: 8px spacing from adjacent text

---

## Visual Principles

### 1. Hierarchy

**The eye should naturally flow:**
1. Page title (largest, darkest, most prominent)
2. Section title (smaller, still prominent)
3. Card titles (medium, clear)
4. Body text (readable, comfortable size)
5. Labels and hints (small, muted)

Never put too many elements at the same visual weight.

### 2. Spacing & Layout

- **Maximum content width**: 1200px (comfortable reading)
- **Padding**: 24px on desktop, 16px on mobile
- **Gap between cards**: 24px
- **Internal card padding**: 1.5rem (24px)
- **Section margin-bottom**: 48px

**Principle**: Generous spacing makes the interface calm and scannable.

### 3. Shadows

Use **soft, subtle shadows** only:
- **Light shadow** (cards): `0 1px 3px rgba(21, 34, 59, 0.02), 0 8px 16px rgba(21, 34, 59, 0.04)`
- **Medium shadow** (hover): `0 1px 3px rgba(21, 34, 59, 0.03), 0 12px 24px rgba(21, 34, 59, 0.06)`
- **Dark shadow** (elevation): `0 20px 25px rgba(21, 34, 59, 0.08)`

Never use harsh, heavy shadows. Never use multiple layers of shadows.

### 4. Borders

- **Card borders**: 1px solid #E5E9F0 (very light, almost invisible)
- **Section dividers**: 1px solid #F1F5F9 (even lighter)
- **Input borders**: 1px solid #E5E9F0 (normal), #4F80FF on focus

### 5. Transitions

All interactive elements should have smooth, intentional transitions:
- **All duration**: 0.2s or 0.3s
- **Easing**: ease-out for exits, ease-in-out for complex motion
- **Avoid**: Anything over 0.5s (feels slow)

---

## Page-Specific Guidelines

### Dashboard

- **Hero Section**: Large, welcoming title + optional greeting
- **Status Summary**: Single, prominent readiness score or status card
- **Next Action**: One clear, large CTA button
- **Content Below**: Progress, latest session, coaching message
- **Maximum items on dashboard**: 5–6 elements (including nav, footer)
- **Feeling**: Calm home base, not crowded

### Profile

- **Structure**: Sections (Basic Info, Education, Experience, Skills, Languages)
- **Each section**: Clear header + content + add/edit buttons
- **Layout**: One column on mobile, optional two columns on desktop (but sparse)
- **Feeling**: Organized, easy to edit, not overwhelming

### Interview

- **Focus**: Question + input area + controls
- **Remove distractions**: Minimal UI chrome
- **Progress**: Subtle indicator (not prominent)
- **Status**: Small, unobtrusive status bar
- **Feeling**: Immersive, focused, calm

### Results / Report

- **Header**: Score + interview type + date
- **Key Insights**: 3 major sections (Strength, Improvement, Practice)
- **Details**: Question-by-question review with collapsible answers
- **Color coding**: Green (strength), Orange (improvement), Blue (practice)
- **Feeling**: Honest feedback, encouraging, not punishing

---

## Motion & Micro-interactions

### Page Transitions
```css
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.view.active {
  animation: fadeIn 0.28s ease-out;
}
```

### Button Hover
- Slight color shift
- Subtle shadow increase
- Tiny upward move (1–2px)
- All at 0.2s ease

### Details / Collapsible
- Chevron rotates 180° on open
- Content fades in/expands
- Smooth transition at 0.2s

---

## Accessibility & Trust

- **Color contrast**: All text ≥ 4.5:1 contrast ratio
- **Font sizes**: Minimum 14px (0.875rem) for body text
- **Touch targets**: Minimum 44px × 44px for buttons/clickables
- **Focus indicators**: Visible focus rings on all interactive elements
- **Motion**: Respect `prefers-reduced-motion` media query

---

## Microcopy Tone

- **Warm but professional** — like a mentor, not a friend
- **Clear and direct** — no jargon or marketing speak
- **Encouraging** — support progress, don't judge
- **Specific** — tell users exactly what to do next

**Examples**:
- ✅ "Let's get started with your first interview"
- ❌ "Begin your transformational journey"
- ✅ "You showed great detail here"
- ❌ "Excellent job! 🎉"
- ✅ "Next practice: Focus on including metrics"
- ❌ "We detected weakness in metric usage"

---

## Do's and Don'ts

### ✅ Do
- Use clean, legible typefaces
- Create plenty of whitespace
- Use soft, subtle colors
- Show one clear action per context
- Make interactive elements obvious
- Organize content hierarchically
- Provide clear feedback on actions
- Use consistent spacing

### ❌ Don't
- Use heavy, dark shadows
- Crowd multiple ideas on screen
- Use bright, aggressive accent colors
- Add unnecessary decorative elements
- Use tiny fonts
- Create competing CTAs
- Use gradients excessively
- Use animation for decoration

---

This design system is the foundation for a **premium, trustworthy, minimal interview coaching experience**.
