import * as React from "react"
import type { ProviderGroupId } from "@/types/models"
import {
  getDefaultModelForGroup,
  getModelsForGroup,
  getProviderGroupMetadata,
} from "@/models/catalog"
import { useVisibleProviderGroups } from "@/hooks/use-visible-provider-groups"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ModelPicker(props: {
  disabled?: boolean
  model: string
  onChange: (providerGroup: ProviderGroupId, model: string) => void
  providerGroup: ProviderGroupId
}) {
  const providerGroups = useVisibleProviderGroups()
  const activeProviderGroup = providerGroups.includes(props.providerGroup)
    ? props.providerGroup
    : providerGroups[0] ?? "opencode-free"
  const activeModel =
    activeProviderGroup === props.providerGroup
      ? props.model
      : getDefaultModelForGroup(activeProviderGroup).id
  const models = getModelsForGroup(activeProviderGroup)

  React.useEffect(() => {
    if (props.disabled || props.providerGroup === activeProviderGroup) {
      return
    }

    void props.onChange(
      activeProviderGroup,
      getDefaultModelForGroup(activeProviderGroup).id
    )
  }, [activeProviderGroup, props.disabled, props.onChange, props.providerGroup])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        disabled={props.disabled}
        onValueChange={(value) => {
          const providerGroup = value as ProviderGroupId
          const defaultModel = getDefaultModelForGroup(providerGroup)
          props.onChange(providerGroup, defaultModel.id)
        }}
        value={activeProviderGroup}
      >
        <SelectTrigger className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {providerGroups.map((providerGroup) => (
            <SelectItem key={providerGroup} value={providerGroup}>
              {getProviderGroupMetadata(providerGroup).label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        disabled={props.disabled}
        onValueChange={(value) => props.onChange(activeProviderGroup, value)}
        value={activeModel}
      >
        <SelectTrigger className="min-w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
