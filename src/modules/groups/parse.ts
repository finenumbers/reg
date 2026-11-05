/**
 * Incoming-group row carried from the RTU API read into apply.
 */

export type ParsedRoutingGroup = {
  externalId: string;
  name: string;
};

export type ParsedGroupsPayload = {
  version: number;
  groups: ParsedRoutingGroup[];
};
