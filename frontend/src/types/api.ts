export type UserRole = 'OWNER' | 'STAFF';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthLoginResponse {
  token: string;
  user: User;
}

export interface AuthRegisterResponse {
  organization: Organization;
  user: User;
}

export interface AuthMeResponse {
  user: User;
}

export interface Service {
  id: string;
  organizationId: string;
  name: string;
  durationMinutes: number;
  priceInCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceInput {
  name: string;
  durationMinutes: number;
  priceInCents: number;
  active?: boolean;
}

export interface ProfessionalServiceRelation {
  professionalId: string;
  serviceId: string;
  createdAt?: string;
  service?: Service | null;
}

export interface Professional {
  id: string;
  organizationId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfessionalWithServices extends Professional {
  services?: ProfessionalServiceRelation[];
}

export interface CreateProfessionalInput {
  name: string;
  active?: boolean;
}

export type Weekday =
  'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface WorkSchedule {
  id: string;
  professionalId: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkScheduleInput {
  weekday: Weekday;
  startTime: string;
  endTime: string;
}

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string | null;
}

export type AppointmentStatus = 'SCHEDULED' | 'CANCELLED';

export interface Appointment {
  id: string;
  organizationId: string;
  customerId: string;
  professionalId: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppointmentInput {
  customerId: string;
  professionalId: string;
  serviceId: string;
  startsAt: string;
}

export interface AvailabilityResult {
  date: string;
  weekday: Weekday;
  timezone: string;
  professionalId: string;
  serviceId: string;
  serviceDurationMinutes: number;
  slots: string[];
  availableSlots: string[];
}

export interface ApiErrorResponse {
  message: string;
  issues?: Record<string, string[]>;
}
