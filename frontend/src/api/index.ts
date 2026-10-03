import { apiFetch } from './client.js';
import type {
  Appointment,
  AuthLoginResponse,
  AuthMeResponse,
  AuthRegisterResponse,
  AvailabilityResult,
  CreateAppointmentInput,
  CreateCustomerInput,
  CreateProfessionalInput,
  CreateServiceInput,
  CreateWorkScheduleInput,
  Customer,
  Professional,
  ProfessionalWithServices,
  Service,
  UpdateCustomerInput,
  WorkSchedule,
} from '../types/api.js';

export * from './client.js';

/* ==========================================================================
   Autenticação
   ========================================================================== */
export const authApi = {
  async login(credentials: { email: string; password: string }): Promise<AuthLoginResponse> {
    return apiFetch<AuthLoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  },

  async register(data: {
    organizationName: string;
    name: string;
    email: string;
    password: string;
  }): Promise<AuthRegisterResponse> {
    return apiFetch<AuthRegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getMe(): Promise<AuthMeResponse> {
    return apiFetch<AuthMeResponse>('/auth/me', {
      method: 'GET',
    });
  },
};

/* ==========================================================================
   Serviços
   ========================================================================== */
export const servicesApi = {
  async list(): Promise<Service[]> {
    const res = await apiFetch<{ services: Service[] }>('/services');
    return res.services ?? [];
  },

  async create(data: CreateServiceInput): Promise<Service> {
    const res = await apiFetch<{ service: Service }>('/services', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.service;
  },
};

/* ==========================================================================
   Profissionais e Jornadas
   ========================================================================== */
export const professionalsApi = {
  async list(): Promise<ProfessionalWithServices[]> {
    const res = await apiFetch<{ professionals: ProfessionalWithServices[] }>('/professionals');
    return res.professionals ?? [];
  },

  async create(data: CreateProfessionalInput): Promise<Professional> {
    const res = await apiFetch<{ professional: Professional }>('/professionals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.professional;
  },

  async assignService(professionalId: string, serviceId: string): Promise<void> {
    await apiFetch(`/professionals/${professionalId}/services/${serviceId}`, {
      method: 'POST',
    });
  },

  async listWorkSchedules(professionalId: string): Promise<WorkSchedule[]> {
    const res = await apiFetch<{ schedules: WorkSchedule[] }>(
      `/professionals/${professionalId}/work-schedules`,
    );
    return res.schedules ?? [];
  },

  async createWorkSchedule(
    professionalId: string,
    data: CreateWorkScheduleInput,
  ): Promise<WorkSchedule> {
    const res = await apiFetch<{ schedule: WorkSchedule }>(
      `/professionals/${professionalId}/work-schedules`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    );
    return res.schedule;
  },

  async deleteWorkSchedule(scheduleId: string): Promise<void> {
    await apiFetch(`/work-schedules/${scheduleId}`, {
      method: 'DELETE',
    });
  },
};

/* ==========================================================================
   Clientes
   ========================================================================== */
export const customersApi = {
  async list(search?: string): Promise<Customer[]> {
    const query = search && search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    const res = await apiFetch<{ customers: Customer[] }>(`/customers${query}`);
    return res.customers ?? [];
  },

  async create(data: CreateCustomerInput): Promise<Customer> {
    const res = await apiFetch<{ customer: Customer }>('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.customer;
  },

  async update(id: string, data: UpdateCustomerInput): Promise<Customer> {
    const res = await apiFetch<{ customer: Customer }>(`/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return res.customer;
  },
};

/* ==========================================================================
   Disponibilidade e Reservas (Appointments)
   ========================================================================== */
export const appointmentsApi = {
  async list(filters?: {
    professionalId?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<Appointment[]> {
    const params = new URLSearchParams();
    if (filters?.professionalId) params.set('professionalId', filters.professionalId);
    if (filters?.customerId) params.set('customerId', filters.customerId);
    if (filters?.startDate) params.set('startDate', filters.startDate);
    if (filters?.endDate) params.set('endDate', filters.endDate);

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch<{ appointments: Appointment[] }>(`/appointments${query}`);
    return res.appointments ?? [];
  },

  async create(data: CreateAppointmentInput): Promise<Appointment> {
    const res = await apiFetch<{ appointment: Appointment }>('/appointments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.appointment;
  },

  async cancel(appointmentId: string): Promise<Appointment> {
    const res = await apiFetch<{ appointment: Appointment }>(
      `/appointments/${appointmentId}/cancel`,
      {
        method: 'PATCH',
      },
    );
    return res.appointment;
  },

  async getAvailability(query: {
    professionalId: string;
    serviceId: string;
    date: string;
  }): Promise<AvailabilityResult> {
    const params = new URLSearchParams({
      professionalId: query.professionalId,
      serviceId: query.serviceId,
      date: query.date,
    });
    return apiFetch<AvailabilityResult>(`/availability?${params.toString()}`);
  },
};
