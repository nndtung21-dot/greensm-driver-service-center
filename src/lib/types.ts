export type Branch = {
  id: string;
  branch_code: string;
  branch_name: string;
};

export type ServiceCategory = {
  id: string;
  name: string;
  code: string;
  display_order: number;
};

export type ServiceSubcategory = {
  id: string;
  category_id: string;
  name: string;
  code: string;
  display_order: number;
};

export type DriverLookupResult = {
  id: string;
  name: string;
  sap_id: string | null;
  contract_type: string | null;
};

export type CheckinResult = {
  visit_code: string;
  ticket_code: string;
  queue_number: string;
};

export type CheckinStep =
  | "welcome"
  | "identify"
  | "not_found"
  | "category"
  | "subcategory"
  | "description"
  | "submitting"
  | "success"
  | "error";

// ---------------------------------------------------------------------
// Agent Portal (Phase 3)
// ---------------------------------------------------------------------
export type UserRole = "agent" | "supervisor" | "admin";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  branch_id: string | null;
  department_id: string | null;
  status: "ACTIVE" | "INACTIVE";
};

export type TicketStatus =
  | "WAITING"
  | "CALLED"
  | "PROCESSING"
  | "PENDING"
  | "TRANSFERRED"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED"
  | "NO_SHOW";

// Mirrors the v_agent_queue view
export type AgentQueueRow = {
  ticket_id: string;
  ticket_code: string;
  queue_number: string;
  branch_id: string;
  status: TicketStatus;
  created_at: string;
  called_at: string | null;
  counter_id: string | null;
  counter_code: string | null;
  driver_name: string;
  sap_id: string | null;
  category_name: string;
  case_id: string;
  assigned_agent_id: string | null;
  sla_due_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
};

export type CaseHistoryEntry = {
  id: string;
  action: string;
  old_status: TicketStatus | null;
  new_status: TicketStatus | null;
  note: string | null;
  created_at: string;
  performed_by: string | null;
};

export type CaseDetail = {
  case_id: string;
  status: TicketStatus;
  description: string | null;
  resolution: string | null;
  internal_note: string | null;
  created_at: string;
  started_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  sla_due_at: string | null;
  assigned_agent_id: string | null;
  pending_reason: string | null;
  pending_next_step: string | null;
  pending_expected_at: string | null;
  ticket_id: string;
  ticket_code: string;
  queue_number: string;
  called_at: string | null;
  visit_code: string;
  checkin_at: string;
  branch_name: string;
  driver_name: string;
  sap_id: string | null;
  contract_type: string | null;
  vehicle_type: string | null;
  category_name: string;
  subcategory_name: string | null;
};

export type Department = { id: string; name: string };

export type AgentOption = { id: string; full_name: string; email: string; role: UserRole };

export type Counter = {
  id: string;
  counter_code: string;
  counter_name: string;
  status: "OPEN" | "CLOSED" | "AVAILABLE" | "BUSY" | "OFFLINE";
  branch_id: string;
  default_agent_id: string | null;
};

// TV Display (tv_now_serving RPC)
export type NowServingRow = {
  queue_number: string;
  counter_code: string | null;
  called_at: string;
};

// Feedback
export type FeedbackLookup = {
  case_id: string;
  ticket_code: string;
  queue_number: string;
  status: TicketStatus;
  already_rated: boolean;
};

// Admin — Agent ↔ Category mapping
export type AgentWithBranch = {
  id: string;
  full_name: string;
  email: string;
  branch_id: string | null;
  branch_name?: string;
};

export type AgentCategoryAssignment = { agent_id: string; category_id: string };

// Admin CRUD
export type SlaRule = {
  id: string;
  branch_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  sla_minutes: number;
  status: "ACTIVE" | "INACTIVE";
};

export type PendingUser = { id: string; email: string; created_at: string };

export type AdminProfileRow = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  branch_id: string | null;
  department_id: string | null;
  status: "ACTIVE" | "INACTIVE";
};
