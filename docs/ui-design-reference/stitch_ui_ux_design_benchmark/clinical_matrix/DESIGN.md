---
name: Clinical Matrix
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#525657'
  on-tertiary: '#ffffff'
  tertiary-container: '#6b6e70'
  on-tertiary-container: '#eff1f3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#e0e3e5'
  tertiary-fixed-dim: '#c4c7c9'
  on-tertiary-fixed: '#191c1e'
  on-tertiary-fixed-variant: '#444749'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-bold:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  nav-item:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  sidebar-width: 240px
  container-padding: 2rem
  grid-gutter: 1rem
  stack-sm: 0.5rem
  stack-md: 1.5rem
---

## Brand & Style

This design system is engineered for high-stakes healthcare environments where clarity, precision, and operational efficiency are paramount. The brand personality is **Professional, Systematic, and Authoritative**, aimed at hospital administrators, matrons, and clinical leads who require immediate cognitive processing of complex data.

The visual style is **Corporate / Modern** with a focus on data density and structural integrity. It leverages a rigorous grid system, high-contrast navigation, and a functional color language to reduce fatigue during extended usage. The interface prioritizes content over decoration, using whitespace purposefully to group related clinical information and separate administrative functions.

## Colors

The palette is anchored by a deep **Navy Secondary (#0F172A)** used for the sidebar navigation to provide a strong structural frame. The **Primary Blue (#2563EB)** is reserved for high-priority actions and active states. 

The background uses a tiered white-to-gray system: 
- **Pure White (#FFFFFF)** for primary content cards and data tables.
- **Cool Gray (#F8FAFC)** for the global canvas background to reduce screen glare.

A dedicated semantic palette is used for shift types and status indicators, employing muted pastel backgrounds with saturated icons to ensure categorical distinctness without overwhelming the user in dense matrix views.

## Typography

This design system utilizes **Inter** exclusively to leverage its exceptional legibility in data-heavy interfaces. The typographic scale is compact to maximize information density.

- **Headlines:** Use Bold weights with slight negative letter-spacing for a modern, authoritative feel.
- **Data Tables:** Body text is set at 13px-14px to allow for high row density while maintaining readability.
- **Sidebar:** Navigation labels use Medium weights for better rendering against dark backgrounds.
- **Labels:** Small caps or bolded 12px type is used for table headers and section metadata to create clear visual hierarchy.

## Layout & Spacing

The layout follows a **Fixed Sidebar / Fluid Content** model. 

1.  **Sidebar:** A 240px fixed-width column on the left houses the primary and secondary navigation. Categories are grouped with subtle uppercase headers.
2.  **Main Canvas:** Uses a fluid grid with a 32px (2rem) outer margin.
3.  **Data Matrix:** Specifically designed for horizontal scrolling when data exceeds the viewport. Columns are tightly packed with 12px-16px gutters to ensure clinical staff can view maximum date ranges without excessive scrolling.
4.  **Responsive Behavior:** On tablet, the sidebar collapses into an icon-only rail or a hamburger menu. Content cards stack vertically, and complex tables transition to a horizontal-scroll-only container to preserve data integrity.

## Elevation & Depth

Hierarchy is established primarily through **Tonal Layering** and **Low-Contrast Outlines** rather than heavy shadows.

- **Level 0 (Background):** Light gray (#F8FAFC) canvas.
- **Level 1 (Cards):** Pure white surfaces with a fine 1px border (#E2E8F0). A very soft, 4px blur shadow is used only to lift primary interaction containers.
- **Sidebar:** Deep navy (#0F172A) provides the "bottom" layer of the application, grounding the navigation.
- **Interactive Elements:** Buttons and active tabs use solid primary colors to "pop" from the neutral background.

## Shapes

The design system employs a **Soft (0.25rem)** corner radius for most functional elements to maintain a professional, organized appearance. 

- **Standard Elements:** Input fields, cards, and buttons use a 4px-6px radius.
- **Status Indicators:** Shift tags and status chips use **Pill-shaped (Full)** rounding to distinguish them from actionable buttons and layout containers.
- **Selection States:** Navigation highlights use a 4px radius to follow the standard container language.

## Components

### Buttons
- **Primary:** Solid Blue with white text.
- **Secondary:** White background with 1px gray border and navy text.
- **Icon Buttons:** Used within headers for "Auto-Reschedule" or "Edit" actions, combining a 16px icon with concise text.

### Status Chips (Shift Matrix)
- **Visuals:** Pill-shaped, light tinted background (10% opacity of the category color).
- **Icons:** Each chip includes a small 12px glyph (e.g., Sun for Day, Moon for Night) to provide a secondary visual cue for accessibility.

### Sidebar Navigation
- **Hierarchy:** Bold headers for categories (e.g., STAFF & OPERATIONS).
- **Active State:** A subtle background tint or a left-side accent bar in Primary Blue to indicate the current location.

### Data Tables / Roster
- **Headers:** Light gray background (#F1F5F9) with bolded label text.
- **Cells:** High-density padding (8px-12px) to allow for maximum row visibility.
- **Sticky Headers:** The name and role columns should remain fixed during horizontal scrolling of the date matrix.

### Tabs
- **Style:** Underline style for top-level module navigation, using Primary Blue for the active indicator.