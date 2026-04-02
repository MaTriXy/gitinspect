import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const resolveRepoTargetMock = vi.fn();

vi.mock("@/components/chat", () => ({
  Chat: (props: {
    repoSource?: { owner: string; ref?: string; repo: string };
    sessionId?: string;
  }) => (
    <div data-testid="chat-view">
      {props.sessionId
        ? `session:${props.sessionId}`
        : props.repoSource
          ? `${props.repoSource.owner}/${props.repoSource.repo}${props.repoSource.ref ? `@${props.repoSource.ref}` : ""}`
          : "global"}
    </div>
  ),
}));

vi.mock("@/repo/ref-resolver", () => ({
  resolveRepoTarget: (target: {
    owner: string;
    ref?: string;
    refPathTail?: string;
    repo: string;
    token?: string;
  }) => resolveRepoTargetMock(target),
}));

describe("chat routes", () => {
  it("renders the shared chat component on /chat", async () => {
    const { Route } = await import("@/routes/chat.index");

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("global");
  });

  it("renders loader-resolved data for repo root routes", async () => {
    const { Route } = await import("@/routes/$owner.$repo.index");
    vi.spyOn(Route, "useLoaderData").mockReturnValue({
      owner: "acme",
      ref: "main",
      refOrigin: "default",
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/main",
        fullRef: "refs/heads/main",
        kind: "branch",
        name: "main",
      },
    });

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("acme/demo@main");
  });

  it("renders loader-resolved slash refs for splat routes", async () => {
    const { Route } = await import("@/routes/$owner.$repo.$");
    vi.spyOn(Route, "useLoaderData").mockReturnValue({
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

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("acme/demo@feature/foo");
  });

  it("parses deep tree URLs in the route loader before resolution", async () => {
    const { Route } = await import("@/routes/$owner.$repo.$");
    const loader = Route.options.loader;

    if (typeof loader !== "function") {
      throw new Error("Missing route loader");
    }

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

    await loader({
      abortController: new AbortController(),
      cause: "enter",
      context: undefined,
      deps: {},
      location: undefined,
      navigate: undefined,
      params: {
        _splat: "tree/feature/foo/src/lib",
        owner: "acme",
        repo: "demo",
      },
      parentMatchPromise: Promise.resolve(undefined),
      preload: false,
      route: Route,
    } as never);

    expect(resolveRepoTargetMock).toHaveBeenCalledWith({
      owner: "acme",
      ref: "feature/foo",
      repo: "demo",
    });
  });

  it("decodes encoded tree refs in the route loader before resolution", async () => {
    const { Route } = await import("@/routes/$owner.$repo.$");
    const loader = Route.options.loader;

    if (typeof loader !== "function") {
      throw new Error("Missing route loader");
    }

    resolveRepoTargetMock.mockResolvedValue({
      owner: "acme",
      ref: "main",
      refOrigin: "explicit",
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/main",
        fullRef: "refs/heads/main",
        kind: "branch",
        name: "main",
      },
    });

    await loader({
      abortController: new AbortController(),
      cause: "enter",
      context: undefined,
      deps: {},
      location: undefined,
      navigate: undefined,
      params: {
        _splat: "tree%2Fmain",
        owner: "acme",
        repo: "demo",
      },
      parentMatchPromise: Promise.resolve(undefined),
      preload: false,
      route: Route,
    } as never);

    expect(resolveRepoTargetMock).toHaveBeenCalledWith({
      owner: "acme",
      ref: "main",
      repo: "demo",
    });
  });

  it("passes the session id into the shared chat component for session routes", async () => {
    const { Route } = await import("@/routes/chat.$sessionId");
    vi.spyOn(Route, "useParams").mockReturnValue({
      sessionId: "session-1",
    });

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("session:session-1");
  });
});
