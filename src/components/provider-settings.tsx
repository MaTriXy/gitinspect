import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import {
  disconnectProvider,
  getOAuthProviderName,
  oauthLogin,
  setProviderApiKey,
  type OAuthProviderId,
} from "@/auth/auth-service"
import { isOAuthCredentials } from "@/auth/oauth-types"
import { db } from "@/db/schema"
import { getProviders } from "@/models/catalog"
import { PROVIDER_METADATA } from "@/models/provider-metadata"
import {
  DEFAULT_PROXY_URL,
  PROXY_ENABLED_KEY,
  PROXY_URL_KEY,
  getProxyConfig,
  proxyConfigFromSettingsRows,
} from "@/proxy/settings"
import type { ProviderId } from "@/types/models"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"

const SUBSCRIPTION_OAUTH_ORDER: OAuthProviderId[] = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
]

const OAUTH_ONLY_PROVIDERS = new Set<ProviderId>([
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
])

function isOAuthConnected(value: string | undefined): boolean {
  const trimmed = value?.trim()
  return Boolean(trimmed && isOAuthCredentials(trimmed))
}

export function ProviderSettings(props: {
  onNavigateToProxy?: () => void
}) {
  const providerKeys =
    useLiveQuery(() => db.providerKeys.toArray(), []) ?? []
  const proxySettingRows = useLiveQuery(() =>
    db.settings
      .where("key")
      .anyOf([PROXY_ENABLED_KEY, PROXY_URL_KEY])
      .toArray()
  )

  const proxyConfig = React.useMemo(() => {
    if (proxySettingRows) {
      return proxyConfigFromSettingsRows(proxySettingRows)
    }

    return {
      enabled: true,
      url: DEFAULT_PROXY_URL,
    }
  }, [proxySettingRows])

  const [draftValues, setDraftValues] = React.useState<
    Partial<Record<ProviderId, string>>
  >({})
  const [deviceFlowInfo, setDeviceFlowInfo] = React.useState<
    Partial<
      Record<
        ProviderId,
        {
          userCode: string
          verificationUri: string
        }
      >
    >
  >({})

  React.useEffect(() => {
    setDraftValues(
      Object.fromEntries(
        providerKeys.map((record) => [
          record.provider,
          record.value.trim().startsWith("{") ? "" : record.value,
        ])
      ) as Partial<Record<ProviderId, string>>
    )
  }, [providerKeys])

  const redirectUri =
    typeof window === "undefined"
      ? "/auth/callback"
      : `${window.location.origin}/auth/callback`

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">Subscription Login</h3>
          <p className="text-xs text-muted-foreground">
            Log in with your existing subscription. No API key needed. Tokens are
            stored locally and refreshed automatically.
          </p>
        </div>

        <div className="text-xs text-muted-foreground">
          <p>
            Requests routed through{" "}
            <span className="font-medium text-foreground">
              {proxyConfig.url}
            </span>
            . An untrusted proxy can see your credentials.{" "}
            {props.onNavigateToProxy ? (
              <button
                className="font-medium text-foreground underline underline-offset-4 hover:text-foreground"
                onClick={props.onNavigateToProxy}
                type="button"
              >
                Change in Proxy settings.
              </button>
            ) : (
              <span>Change in Proxy settings.</span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {SUBSCRIPTION_OAUTH_ORDER.map((provider) => {
            const record = providerKeys.find(
              (item) => item.provider === provider
            )
            const connected = isOAuthConnected(record?.value)

            return (
              <div className="space-y-2" key={provider}>
                <Item variant="outline">
                  <ItemContent>
                    <ItemTitle className="text-sm font-medium text-foreground">
                      {getOAuthProviderName(provider)}
                    </ItemTitle>
                    <ItemDescription>
                      {connected ? "Connected" : "Not connected"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto shrink-0">
                    {connected ? (
                      <Button
                        onClick={async () => {
                          await disconnectProvider(provider)
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Logout
                      </Button>
                    ) : (
                      <Button
                        onClick={async () => {
                          const proxy = await getProxyConfig()
                          const credentials = await oauthLogin(
                            provider,
                            redirectUri,
                            (info) =>
                              setDeviceFlowInfo((current) => ({
                                ...current,
                                [provider]: info,
                              })),
                            provider === "anthropic" && proxy.enabled
                              ? { proxyUrl: proxy.url }
                              : undefined
                          )

                          await setProviderApiKey(
                            provider,
                            JSON.stringify(credentials)
                          )
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        Login
                      </Button>
                    )}
                  </ItemActions>
                </Item>

                {deviceFlowInfo[provider] ? (
                  <div className="text-xs text-muted-foreground">
                    Enter code{" "}
                    <span className="font-medium text-foreground">
                      {deviceFlowInfo[provider]?.userCode}
                    </span>{" "}
                    at{" "}
                    <a
                      className="underline underline-offset-4"
                      href={deviceFlowInfo[provider]?.verificationUri}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {deviceFlowInfo[provider]?.verificationUri}
                    </a>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">API Keys</h3>
          <p className="text-xs text-muted-foreground">
            Enter API keys for cloud providers. Keys are stored locally in your
            browser.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {getProviders().filter((provider) => !OAUTH_ONLY_PROVIDERS.has(provider)).map((provider) => (
            <div className="space-y-2" key={provider}>
              <div className="text-sm font-medium text-foreground">
                {PROVIDER_METADATA[provider].label}
              </div>
              <div className="flex gap-2">
                <Input
                  className="min-w-0 flex-1"
                  onChange={(event) =>
                    setDraftValues((current) => ({
                      ...current,
                      [provider]: event.target.value,
                    }))
                  }
                  placeholder="Enter API key"
                  value={draftValues[provider] ?? ""}
                />
                <Button
                  className="shrink-0"
                  onClick={async () => {
                    const value = draftValues[provider]?.trim()

                    if (!value) {
                      return
                    }

                    await setProviderApiKey(provider, value)
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Save
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
