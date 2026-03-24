import type { SessionData } from "@/types/storage"
import { CostsPanel } from "@/components/costs-panel"
import { ProviderSettings } from "@/components/provider-settings"
import { ProxySettings } from "@/components/proxy-settings"
import { RepoSettings } from "@/components/repo-settings"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

export function SettingsDialog(props: {
  onRepoSourceChange: (repoSource?: SessionData["repoSource"]) => Promise<void>
  onOpenChange: (open: boolean) => void
  open: boolean
  session: SessionData
  settingsDisabled?: boolean
}) {
  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage local provider credentials, proxy behavior, and cost tracking.
          </DialogDescription>
        </DialogHeader>
        <Tabs className="gap-4" defaultValue="providers">
          <TabsList variant="line">
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="repo">Repo</TabsTrigger>
            <TabsTrigger value="proxy">Proxy</TabsTrigger>
            <TabsTrigger value="costs">Costs</TabsTrigger>
          </TabsList>
          <TabsContent value="providers">
            <ProviderSettings />
          </TabsContent>
          <TabsContent value="repo">
            <RepoSettings
              disabled={props.settingsDisabled}
              onSave={props.onRepoSourceChange}
              session={props.session}
            />
          </TabsContent>
          <TabsContent value="proxy">
            <ProxySettings />
          </TabsContent>
          <TabsContent value="costs">
            <CostsPanel session={props.session} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
