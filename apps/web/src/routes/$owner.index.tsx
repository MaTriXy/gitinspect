import { createFileRoute, redirect } from "@tanstack/react-router";
import { isReservedRootOwnerSegment } from "@gitinspect/pi/repo/path-parser";
import { OrgRepoPicker } from "@gitinspect/ui/components/org-repo-picker";

export const Route = createFileRoute("/$owner/")({
  beforeLoad: ({ params }) => {
    if (isReservedRootOwnerSegment(params.owner)) {
      throw redirect({ to: "/" });
    }
  },
  component: OwnerLandingRoute,
});

function OwnerLandingRoute() {
  const { owner } = Route.useParams();
  return <OrgRepoPicker ownerLogin={owner} />;
}
