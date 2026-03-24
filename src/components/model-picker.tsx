import type { ProviderGroupId } from "@/types/models"
import {
  getDefaultModelForGroup,
  getModelsForGroup,
  getProviderGroupMetadata,
  getProviderGroups,
} from "@/models/catalog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ModelPicker(props: {
  model: string
  onChange: (providerGroup: ProviderGroupId, model: string) => void
  providerGroup: ProviderGroupId
}) {
  const providerGroups = getProviderGroups()
  const models = getModelsForGroup(props.providerGroup)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        onValueChange={(value) => {
          const providerGroup = value as ProviderGroupId
          const defaultModel = getDefaultModelForGroup(providerGroup)
          props.onChange(providerGroup, defaultModel.id)
        }}
        value={props.providerGroup}
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
        onValueChange={(value) => props.onChange(props.providerGroup, value)}
        value={props.model}
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
