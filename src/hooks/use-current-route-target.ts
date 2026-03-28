import { useRouterState } from "@tanstack/react-router"

export function useCurrentRouteTarget():
  | {
      to: "/"
    }
  | {
      to: "/chat"
    }
  | {
      params: {
        owner: string
        repo: string
      }
      to: "/$owner/$repo"
    }
  | {
      params: {
        _splat: string
        owner: string
        repo: string
      }
      to: "/$owner/$repo/$"
    } {
  const match = useRouterState({
    select: (state) => state.matches[state.matches.length - 1],
  })

  switch (match.routeId) {
    case "/chat":
      return { to: "/chat" }
    case "/$owner/$repo/":
      return {
        params: {
          owner: match.params.owner,
          repo: match.params.repo,
        },
        to: "/$owner/$repo",
      }
    case "/$owner/$repo/$":
      return {
        params: {
          _splat: match.params._splat ?? "",
          owner: match.params.owner,
          repo: match.params.repo,
        },
        to: "/$owner/$repo/$",
      }
    default:
      return { to: "/" }
  }
}
