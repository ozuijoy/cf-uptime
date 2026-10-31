import type { CheckStatus, IncidentImpact, IncidentStatus, MonitorStatus } from '../api/types';
import type { MessageKey } from './messages';

type TFunction = (key: MessageKey, values?: Record<string, string | number>) => string;

export function statusLabel(status: MonitorStatus | CheckStatus, t: TFunction): string {
  return t(`status.${status}` as MessageKey);
}

export function incidentStatusLabel(status: IncidentStatus, t: TFunction): string {
  return t(`incident_status.${status}` as MessageKey);
}

export function incidentImpactLabel(impact: IncidentImpact, t: TFunction): string {
  return t(`incident_impact.${impact}` as MessageKey);
}
