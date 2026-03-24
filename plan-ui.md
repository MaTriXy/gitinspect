# `/chat` UI Implementation Plan

## Goal

Build an exact UI/layout copy of the old `web-old` chat screen inside the new TanStack route at `src/routes/chat.tsx`.

For the first pass:

- UI only
- no backend wiring
- no session actions
- no send/abort logic
- no model/provider persistence wiring

The target is the old shell structure:

- left session sidebar
- sticky top header
- center content canvas
- footer user/actions area
- no functional behavior beyond static demo interactions

---

## Detailed Todo List

### Phase 1: Route entry

- [x] Replace the `/chat` placeholder route with a thin wrapper that renders the new chat page shell. Old UI ref: [old chat route shell](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L85) and [old placeholder page](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/page.tsx#L1).
- [x] Keep `src/routes/chat.tsx` free of layout logic so the route only imports and mounts the new composition component. Old UI ref: [old app delegated layout responsibility to the route layout](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L85).

### Phase 2: Root shell composition

- [x] Create a dedicated `ChatPage` or `ChatShell` component that owns the full-page flex layout. Old UI ref: [outer `SidebarProvider` + full-height shell](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L89).
- [x] Wrap the page in `SidebarProvider` and `SidebarInset` so the structure matches the old app’s collapsible sidebar layout. Old UI ref: [sidebar provider and inset wrapper](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L89).
- [x] Use `min-h-screen`, `w-full`, and `overscroll-none` on the root container to preserve the old app’s viewport behavior. Old UI ref: [root layout container](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L90).

### Phase 3: Left sidebar

- [x] Build `ChatSidebar` as a standalone component using `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, and `SidebarRail`. Old UI ref: [old chat sidebar component](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/chat-sidebar.tsx#L179).
- [x] Copy the logo header layout exactly, including the 12px-high header band and border separation. Old UI ref: [sidebar header + logo](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/chat-sidebar.tsx#L183) and [logo implementation](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/logo.tsx#L3).
- [x] Add the session list section under the logo using a separate component so the grouping logic stays isolated. Old UI ref: [sessions list slot](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/chat-sidebar.tsx#L187).
- [x] Recreate the footer navigation links for `Home` and `Popular` in the sidebar footer. Old UI ref: [footer links block](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/chat-sidebar.tsx#L190).
- [x] Recreate the account/user menu at the bottom of the sidebar as a dropdown menu anchored in the footer. Old UI ref: [user menu entry point in sidebar footer](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/chat-sidebar.tsx#L207) and [dropdown content pattern](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-user.tsx#L29).

### Phase 4: Session list behavior

- [x] Implement the date-bucketed session grouping: Today, Yesterday, Last 7 Days, Last 30 Days, Older. Old UI ref: [session categorization logic](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx#L39) and [category labels](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx#L158).
- [x] Filter out parent/branch sessions before rendering the list. Old UI ref: [parent session filter](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx#L57).
- [x] Sort sessions by `time.updated` descending before bucketing. Old UI ref: [updated-time sorting](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx#L59).
- [x] Render each grouped section using `SidebarGroup` and `SidebarGroupLabel` to match the old sidebar hierarchy. Old UI ref: [grouped sidebar render](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx#L185).
- [x] Add a static `New Chat` button at the top of the list in the same visual treatment as the old UI. Old UI ref: [new chat button block](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx#L168).
- [x] Add the session row actions area with a delete affordance even if it stays inert for now. Old UI ref: [session row action / delete dialog pattern](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx#L106).

### Phase 5: Header bar

- [x] Recreate the sticky top header with the exact two-zone layout: left utility cluster and right search/controls cluster. Old UI ref: [chat header structure](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L93).
- [x] Add the sidebar trigger, vertical separator, and breadcrumb/title block on the left side of the header. Old UI ref: [header left cluster](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L94).
- [x] Keep the page title as `New Chat` for now, matching the old layout placeholder. Old UI ref: [breadcrumb title placeholder](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L103).
- [x] Add the search field with embedded shortcut keycaps on the right side of the header. Old UI ref: [search field with keycaps](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L111).
- [x] Add the three utility buttons/links to the right side of the header, keeping separators between them. Old UI ref: [header utility controls](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L131).

### Phase 6: Main content area

- [x] Create the center pane as a simple full-height body area under the sticky header. Old UI ref: [main content slot](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L157).
- [x] For the first pass, keep the body static and visual only, with no data or chat actions wired in. Old UI ref: [old page is a stub and does not drive content](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/page.tsx#L1).
- [x] Reserve the body for later chat content insertion, but do not add runtime logic yet. Old UI ref: [route body deferred to children](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L157).

### Phase 7: Supporting chrome

- [x] Implement the product mark as a separate `ChatLogo` component with the same split word styling. Old UI ref: [logo wordmark styling](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/logo.tsx#L3).
- [x] Implement the footer user/avatar dropdown as a separate `ChatUserMenu` component so the sidebar footer stays composable. Old UI ref: [nav user dropdown](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-user.tsx#L29).
- [x] Keep any future “home” or “popular” navigation links as footer-only elements, not in the header or body. Old UI ref: [footer link placement](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/chat-sidebar.tsx#L190).
- [x] Replace placeholder iconography with the old SVG icon set in the header, footer, and menu actions. Old UI ref: [old icons module](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/icons.tsx#L1).
- [x] Wire a real theme provider and theme toggle so dark/light switching actually updates the document class. Old UI ref: [old theme switcher](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/theme-switcher.tsx#L1).
- [x] Tighten the wordmark styling to match the old `git overflow` logo treatment as closely as the current font stack allows. Old UI ref: [old logo](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/logo.tsx#L3).
- [x] Apply theme-aware icon colors so header, sidebar, and menu icons follow the active theme rather than rendering as dark glyphs. Old UI ref: [old icons module](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/icons.tsx#L1).
- [x] Remove the separator between the sidebar trigger and the `New Chat` breadcrumb/title block. Old UI ref: [old header layout](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L94).

### Phase 8: Verification

- [x] Compare the new `/chat` route against the old `web-old` shell at the viewport level before wiring behavior. Old UI ref: [entire old layout shell](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L89).
- [x] Confirm the sidebar width, header height, and spacing read like the old UI rather than the current `AppShell`. Old UI ref: [old layout dimensions and header bands](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L90).
- [x] Confirm the route file remains thin and the composition lives in `components/new/*`. Old UI ref: [old route layout owns composition, not the page](/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx#L85).

---

## Source Of Truth

Use the old app as the visual reference:

- `/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/app/chat/layout.tsx`
- `/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/chat-sidebar.tsx`
- `/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-sessions.tsx`
- `/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/logo.tsx`
- `/Users/jeremy/Developer/v1/gitoverflow-v0/apps/web-old/src/components/nav-user.tsx`

Use the current repo only for reusable primitives:

- `/Users/jeremy/Developer/gitoverflow/src/components/ui/sidebar.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/breadcrumb.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/separator.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/input.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/button.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/dropdown-menu.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/avatar.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/alert-dialog.tsx`
- `/Users/jeremy/Developer/gitoverflow/src/components/ui/scroll-area.tsx`

---

## Required Visual Match

The `/chat` route should match the old layout behaviorally and visually:

- full-height page
- sidebar fixed on the left
- route header sticky at the top of the main pane
- search input in the header
- utility buttons/icons in the header
- main route body below the header
- sidebar header with logo
- sidebar middle with grouped session list
- sidebar footer with links and user menu

Do not collapse this into the current `AppShell` shape. This route should be its own shell.

---

## Proposed File Structure

Create a small route-specific UI layer under `components/new`:

- `src/components/new/chat-shell.tsx`
- `src/components/new/chat-sidebar.tsx`
- `src/components/new/chat-session-list.tsx`
- `src/components/new/chat-header.tsx`
- `src/components/new/chat-footer.tsx`
- `src/components/new/chat-logo.tsx`
- `src/components/new/chat-user-menu.tsx`
- `src/components/new/chat-page.tsx`

These files should contain the exact layout composition for `/chat`, while the route file stays thin.

---

## Implementation Phases

### Phase 1: Route shell only

Replace the placeholder in `src/routes/chat.tsx` with a wrapper that mounts the new shell component.

Planned route shape:

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { ChatPage } from "@/components/new/chat-page"

export const Route = createFileRoute("/chat")({
  component: ChatRoute,
})

function ChatRoute() {
  return <ChatPage />
}
```

This route should not read backend data yet.

### Phase 2: Build the static shell

Create a route-specific shell that mirrors the old `SidebarProvider` layout.

Planned structure:

```tsx
export function ChatPage() {
  return (
    <SidebarProvider>
      <div className="relative flex min-h-screen w-full overscroll-none">
        <ChatSidebar />

        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <ChatHeader />
          <main className="flex-1 overflow-hidden">
            <div className="h-full p-4">{/* body placeholder for now */}</div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
```

Match the old route layout:

- `SidebarProvider` at the root
- `ChatSidebar` as the left rail
- `SidebarInset` for the main pane
- sticky header inside the inset
- scrollable main body below

### Phase 3: Sidebar composition

Recreate the old sidebar exactly as a composition of existing UI primitives.

Sidebar sections:

1. header
2. sessions list
3. footer links
4. user menu
5. rail

Planned sidebar structure:

```tsx
export function ChatSidebar() {
  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="h-12 border-b">
        <ChatLogo />
      </SidebarHeader>

      <SidebarContent>
        <ChatSessionList sessions={demoSessions} />
      </SidebarContent>

      <SidebarFooter className="border-t">
        <ChatFooter />
        <ChatUserMenu />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
```

### Phase 4: Session grouping

The old sidebar groups sessions by time buckets:

- Today
- Yesterday
- Last 7 Days
- Last 30 Days
- Older

It also excludes parent/branch sessions and sorts by newest updated first.

Planned grouping utility:

```tsx
type Session = {
  id: string
  title: string
  time: { updated: number }
  parentID?: string
}

export function getCategorizedSessions(sessions: Session[]) {
  // sort newest first, filter parent sessions, bucket by updated date
}
```

Planned list rendering:

```tsx
export function ChatSessionList({ sessions }: { sessions: Session[] }) {
  return (
    <>
      <div className="p-2">
        <Button className="h-10 w-full rounded-none bg-foreground" size="lg">
          New Chat
        </Button>
      </div>

      <SidebarSeparator className="mx-0" />

      <SidebarContent className="no-scrollbar overscroll-contain">
        {/* render grouped SidebarGroup blocks here */}
      </SidebarContent>
    </>
  )
}
```

For the first pass, the `New Chat` button can be static.

### Phase 5: Header composition

The old header is a two-zone bar:

- left side: sidebar trigger, separator, breadcrumb/title
- right side: search field, shortcuts, utility buttons

Planned header structure:

```tsx
export function ChatHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background">
      <div className="flex flex-1 items-center gap-2 px-3">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-2" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage className="line-clamp-1 text-base">
                New Chat
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex items-center gap-2 px-3">
        <div className="relative flex items-center">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
          <Input className="h-8 pr-16 pl-9" placeholder="Search..." />
          <div className="absolute right-2 flex items-center gap-1">
            <kbd className="...">⌘</kbd>
            <kbd className="...">K</kbd>
          </div>
        </div>
        <Separator orientation="vertical" />
        <Button asChild variant="ghost" size="sm" className="h-8 shadow-none">
          <a href="#" target="_blank" rel="noreferrer">...</a>
        </Button>
        <Separator orientation="vertical" />
        <Button variant="ghost" size="sm" className="h-8 shadow-none">
          GitHub
        </Button>
        <Separator orientation="vertical" />
        <Button variant="ghost" size="sm" className="h-8 shadow-none">
          Theme
        </Button>
      </div>
    </header>
  )
}
```

The initial version can use static icons/links, as long as the spacing, grouping, and stickiness match.

### Phase 6: Footer and user menu

The old sidebar footer has:

- two text links
- a user menu dropdown

Planned footer:

```tsx
export function ChatFooter() {
  return (
    <div className="space-y-1 p-2">
      <Link className="flex items-center gap-2 px-3 py-2 text-sm" href="/">
        Home
      </Link>
      <Link className="flex items-center gap-2 px-3 py-2 text-sm" href="/">
        Popular
      </Link>
    </div>
  )
}
```

Planned user menu:

```tsx
export function ChatUserMenu() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <Avatar className="h-8 w-8 rounded-lg" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">shadcn</span>
                <span className="truncate text-xs">m@example.com</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
```

### Phase 7: Main body placeholder

For the first pass, the center body can be a static placeholder card or blank canvas, as long as the outer shell is correct.

Recommended temporary body:

```tsx
<main className="flex-1 overflow-hidden">
  <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
    Chat body placeholder
  </div>
</main>
```

This keeps the work scoped to UI composition and avoids premature wiring.

---

## Exact Component Mapping

Old UI -> new composition target:

- `ChatSidebar` -> `src/components/new/chat-sidebar.tsx`
- `NavSessions` -> `src/components/new/chat-session-list.tsx`
- `Logo` -> `src/components/new/chat-logo.tsx`
- `NavUser` -> `src/components/new/chat-user-menu.tsx`
- route layout -> `src/components/new/chat-shell.tsx`
- page body -> `src/components/new/chat-page.tsx`
- route entry -> `src/routes/chat.tsx`

The existing generic shell in `src/components/app-shell.tsx` should stay untouched for this pass unless something is directly reusable.

---

## Reuse Rules

Use existing primitives wherever possible:

- `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarRail`
- `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbPage`
- `Input`, `Button`, `Separator`
- `Avatar`, `DropdownMenu`, `AlertDialog`
- `ScrollArea`

Do not add backend calls, session mutations, or runtime logic in this pass.

If a component needs props for future wiring, pass them in but feed them static demo values for now.

---

## Styling Notes

To match the old UI, keep these visual traits:

- `h-12` top bar
- `border-b` and `border-r` structure
- compact spacing
- muted secondary text
- rounded-none or minimal rounding where the old UI uses sharp edges
- sidebar width around `w-80`
- sticky header
- full viewport height

The old app is more “product shell” than “app marketing page”, so avoid decorative redesign in the first pass.

---

## Acceptance Criteria

The first pass is complete when:

- `/chat` renders the new shell
- the left sidebar matches the old arrangement
- the header matches the old arrangement
- session grouping is visible in the sidebar
- the footer/user menu is present
- the main pane occupies the remaining width and height
- no actions need to work yet
- the UI is built from local components and new route-specific composition files

---

## Suggested Build Order

1. Create `src/components/new/chat-page.tsx` and `src/components/new/chat-shell.tsx`.
2. Add `ChatSidebar`, `ChatSessionList`, `ChatHeader`, and footer/user menu components.
3. Move static demo data into the new session list component.
4. Wire `src/routes/chat.tsx` to the new shell.
5. Verify the layout against the old `web-old` chat shell.

---

## Non-Goals For This Pass

- no session CRUD
- no send/abort behavior
- no provider auth flow
- no model switching logic
- no persistence wiring
- no streaming chat runtime
- no tool execution
- no backend integration

The only goal is to reproduce the old UI shell in `/chat` as faithfully as possible.
