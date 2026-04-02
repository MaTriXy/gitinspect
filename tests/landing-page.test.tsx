import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const listRepositoriesMock = vi.fn(async () => []);
const navigateMock = vi.fn();
const useSearchMock = vi.fn(() => ({}));
const parseRepoQueryMock = vi.fn();
const resolveRepoTargetMock = vi.fn();

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a data-to={to}>{children}</a>
  ),
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}));

vi.mock("@/db/schema", () => ({
  listRepositories: () => listRepositoriesMock(),
}));

vi.mock("@/repo/parse", () => ({
  parseRepoQuery: (raw: string) => parseRepoQueryMock(raw),
}));

vi.mock("@/repo/ref-resolver", () => ({
  resolveRepoTarget: (source: unknown) => resolveRepoTargetMock(source),
}));

vi.mock("@/repo/github-fetch", () => ({
  handleGithubError: vi.fn(async () => false),
}));

vi.mock("@/components/chat-logo", () => ({
  ChatLogo: () => <div>logo</div>,
}));

vi.mock("@/components/github-repo", () => ({
  GithubRepo: ({
    owner,
    ref,
    repo,
    to,
  }: {
    owner: string;
    ref?: string;
    repo: string;
    to: string;
  }) => (
    <div data-testid={`repo-${owner}-${repo}`} data-to={to}>
      {owner}/{repo}
      {ref ? `@${ref}` : ""}
    </div>
  ),
}));

vi.mock("@/components/ui/input-group", () => ({
  InputGroup: ({ children, className }: React.ComponentProps<"div">) => (
    <div className={className}>{children}</div>
  ),
  InputGroupAddon: ({ children }: React.ComponentProps<"div">) => <div>{children}</div>,
  InputGroupButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  InputGroupInput: (props: React.ComponentProps<"input">) => <input {...props} />,
  InputGroupText: ({ children }: React.ComponentProps<"span">) => <span>{children}</span>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/icons", () => ({
  Icons: {
    clock: () => <span>clock</span>,
    gitHub: () => <span>github</span>,
    sparkles: () => <span>sparkles</span>,
  },
}));

describe("LandingPage", () => {
  beforeEach(() => {
    listRepositoriesMock.mockReset();
    navigateMock.mockReset();
    parseRepoQueryMock.mockReset();
    resolveRepoTargetMock.mockReset();
    useSearchMock.mockReset();
    useSearchMock.mockReturnValue({});
  });

  it("preserves explicit refs for suggested repos", async () => {
    const { LandingPage } = await import("@/components/landing-page");

    render(<LandingPage />);

    expect(screen.getByTestId("repo-anomalyco-opencode").getAttribute("data-to")).toBe(
      "/anomalyco/opencode/dev",
    );
  });

  it("navigates using the resolved repo source from the landing form", async () => {
    parseRepoQueryMock.mockReturnValue({
      owner: "acme",
      refPathTail: "feature/foo/src/lib",
      repo: "demo",
    });
    resolveRepoTargetMock.mockResolvedValue({
      owner: "acme",
      ref: "feature/foo",
      refOrigin: "explicit",
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/feature/foo",
        fullRef: "refs/heads/feature/foo",
        kind: "branch",
        name: "feature/foo",
      },
    });

    const { LandingPage } = await import("@/components/landing-page");

    render(<LandingPage />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("GitHub repository URL or owner/repo"), {
        target: { value: "https://github.com/acme/demo/tree/feature/foo/src/lib" },
      });
      fireEvent.click(screen.getByLabelText("Continue to workspace"));
    });

    expect(resolveRepoTargetMock).toHaveBeenCalledWith({
      owner: "acme",
      refPathTail: "feature/foo/src/lib",
      repo: "demo",
    });
    expect(navigateMock).toHaveBeenCalledWith({
      search: {
        settings: undefined,
        sidebar: undefined,
      },
      to: "/acme/demo/feature/foo",
    });
  });
});
