import * as React from "react";
import { configureDbCloud, syncDb } from "@gitinspect/db";
import { env } from "@gitinspect/env/web";
import { type FeedbackSentiment, parseFeedbackSentiment } from "@gitinspect/shared/feedback";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  retainSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";
import { Analytics as OneDollarStats } from "@/components/analytics";
import { AppAuthProvider } from "@/components/app-auth-provider";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthDialogWrapper } from "@/components/auth-dialog-wrapper";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { PricingSettingsPanel } from "@/components/pricing-settings-panel";
import { RootGuard } from "@/components/root-guard";
import { getDexieBootstrap } from "@/functions/get-dexie-bootstrap";
import { useSubscription } from "@/hooks/use-subscription";
import { parseSettingsSection } from "@/navigation/search-state";
import { DataSettings } from "@gitinspect/ui/components/data-settings";
import { SidebarInset, SidebarProvider } from "@gitinspect/ui/components/sidebar";
import { AppSettingsDialog } from "@gitinspect/ui/components/settings-dialog";
import { ThemeProvider } from "@gitinspect/ui/components/theme-provider";
import { Toaster } from "@gitinspect/ui/components/sonner";
import { TooltipProvider } from "@gitinspect/ui/components/tooltip";
import { AutumnProvider } from "autumn-js/react";
import appCss from "../styles.css?url";

type RootSearchInput = {
  feedback?: string;
  feedbackIncludeDiagnostics?: string;
  feedbackMessage?: string;
  feedbackSentiment?: string;
  settings?: string;
  sidebar?: string;
};

type RootSearch = {
  feedback?: "open";
  feedbackIncludeDiagnostics?: boolean;
  feedbackMessage?: string;
  feedbackSentiment?: FeedbackSentiment;
  settings?: ReturnType<typeof parseSettingsSection>;
  sidebar?: "open";
};

export const Route = createRootRoute({
  loader: () => getDexieBootstrap(),
  staleTime: Infinity,
  validateSearch: (search: RootSearchInput): RootSearch => ({
    feedback: search.feedback === "open" ? "open" : undefined,
    feedbackIncludeDiagnostics: search.feedbackIncludeDiagnostics === "true" ? true : undefined,
    feedbackMessage:
      typeof search.feedbackMessage === "string" && search.feedbackMessage.length > 0
        ? search.feedbackMessage.slice(0, 2_000)
        : undefined,
    feedbackSentiment: parseFeedbackSentiment(search.feedbackSentiment),
    settings: parseSettingsSection(search.settings),
    sidebar: search.sidebar === "open" ? "open" : undefined,
  }),
  search: {
    middlewares: [retainSearchParams(["settings", "sidebar", "feedback"])],
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "gitinspect.com",
      },
      {
        name: "description",
        content: "Chat with any github repo",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "gitinspect",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon-96x96.png",
        sizes: "96x96",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "shortcut icon",
        href: "/favicon.ico",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/site.webmanifest",
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
  component: RootLayout,
  ssr: false,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
        <Scripts />
        <VercelAnalytics />
        <OneDollarStats />
      </body>
    </html>
  );
}

function RootLayout() {
  const { syncEnabled } = Route.useLoaderData();

  configureDbCloud({
    // Sync is intentionally disabled for now; keep Dexie local-only until we decide to ship paid sync.
    databaseUrl: undefined,
    fetchTokens: async (tokenParams) => {
      const response = await fetch("/api/auth/dexie-cloud/token", {
        body: JSON.stringify(tokenParams),
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch Dexie Cloud token.");
      }

      return await response.json();
    },
    syncEnabled,
  });

  React.useEffect(() => {
    if (!syncEnabled) {
      return;
    }

    void syncDb().catch((error) => {
      console.error("Could not initialize Dexie sync", error);
    });
  }, [syncEnabled]);

  return (
    <AppAuthProvider>
      <AutumnProvider
        backendUrl={env.VITE_BETTER_AUTH_URL}
        includeCredentials
        pathPrefix="/api/autumn"
      >
        <RootAppChrome />
      </AutumnProvider>
    </AppAuthProvider>
  );
}

function RootAppChrome() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { isSignedIn, subscriptionState } = useSubscription();

  return (
    <RootGuard>
      <SidebarProvider
        onOpenChange={(open) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              sidebar: open ? "open" : undefined,
            }),
            to: ".",
          });
        }}
        open={search.sidebar === "open"}
      >
        <div className="relative flex h-svh w-full overflow-hidden overscroll-none">
          <AppSidebar />
          <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <AppHeader />
            <main className="flex min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </main>
          </SidebarInset>
        </div>
        <AppSettingsDialog
          dataPanel={
            <DataSettings
              canRequestSync={subscriptionState?.isSubscribed === true}
              onRequestSync={() => {
                void navigate({
                  replace: true,
                  search: (prev) => ({
                    ...prev,
                    feedback: "open",
                    feedbackIncludeDiagnostics: undefined,
                    feedbackMessage:
                      "Implement the fucking sync feature across devices someone is paying for it ! (Press enter for me to receive this message)",
                    feedbackSentiment: "sad",
                  }),
                  to: ".",
                });
              }}
            />
          }
          pricingLabel={isSignedIn ? "Subscription" : "Get Pro"}
          pricingPanel={<PricingSettingsPanel />}
        />
        <FeedbackDialog />
      </SidebarProvider>
      <AuthDialogWrapper />
      <Toaster position="bottom-right" />
    </RootGuard>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-medium">Page not found</h1>
      <p className="max-w-md text-xs text-muted-foreground">
        The route does not exist or the dev server reloaded while the router was resolving the page.
      </p>
      <Link
        className="text-xs underline underline-offset-4 hover:text-foreground"
        search={{
          tab: undefined,
          feedback: undefined,
          settings: undefined,
          sidebar: undefined,
        }}
        to="/"
      >
        Go back home
      </Link>
    </div>
  );
}
