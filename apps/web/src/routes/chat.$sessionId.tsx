import { createFileRoute } from "@tanstack/react-router";
import { Chat } from "@gitinspect/ui/components/chat";

export const Route = createFileRoute("/chat/$sessionId")({
  component: SessionChatRoute,
});

function SessionChatRoute() {
  const { sessionId } = Route.useParams();

  return <Chat sessionId={sessionId} />;
}
