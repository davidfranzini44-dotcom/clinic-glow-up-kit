export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          id: number
          swaps_locked: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          swaps_locked?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          swaps_locked?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      appointment_notes: {
        Row: {
          appointment_id: string
          created_at: string
          id: string
          observations: string | null
          treatments: string | null
          updated_at: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          id?: string
          observations?: string | null
          treatments?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          id?: string
          observations?: string | null
          treatments?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_notes_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_swap_requests: {
        Row: {
          appointment_id: string
          created_at: string
          from_employee: string
          from_user_id: string
          id: string
          kind: string
          note: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["swap_status"]
          target_appointment_id: string | null
          to_employee: string
          to_user_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          from_employee: string
          from_user_id: string
          id?: string
          kind?: string
          note?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["swap_status"]
          target_appointment_id?: string | null
          to_employee: string
          to_user_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          from_employee?: string
          from_user_id?: string
          id?: string
          kind?: string
          note?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["swap_status"]
          target_appointment_id?: string | null
          to_employee?: string
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_swap_requests_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          arrived_at: string | null
          cabin: number | null
          cancelled: boolean
          changed: string
          client: string
          date: string
          employee: string | null
          id: string
          no_show: boolean
          swap_locked: boolean
          time: string
          time_mins: number
          updated_at: string
          walk_in: boolean
        }
        Insert: {
          arrived_at?: string | null
          cabin?: number | null
          cancelled?: boolean
          changed?: string
          client: string
          date: string
          employee?: string | null
          id: string
          no_show?: boolean
          swap_locked?: boolean
          time: string
          time_mins: number
          updated_at?: string
          walk_in?: boolean
        }
        Update: {
          arrived_at?: string | null
          cabin?: number | null
          cancelled?: boolean
          changed?: string
          client?: string
          date?: string
          employee?: string | null
          id?: string
          no_show?: boolean
          swap_locked?: boolean
          time?: string
          time_mins?: number
          updated_at?: string
          walk_in?: boolean
        }
        Relationships: []
      }
      cash_closures: {
        Row: {
          azul_counted: number
          azul_system: number
          bills_100: number
          bills_1000: number
          bills_200: number
          bills_2000: number
          bills_50: number
          bills_500: number
          card_terminal_counted: number
          card_terminal_system: number
          cash_counted: number
          cash_difference: number
          cash_system: number
          closed_by: string | null
          coins_1: number
          coins_10: number
          coins_25: number
          coins_5: number
          created_at: string
          created_by: string | null
          date: string
          id: string
          net_total: number
          notes: string | null
          total_expenses: number
          total_income: number
          transfers_counted: number
          transfers_system: number
        }
        Insert: {
          azul_counted?: number
          azul_system?: number
          bills_100?: number
          bills_1000?: number
          bills_200?: number
          bills_2000?: number
          bills_50?: number
          bills_500?: number
          card_terminal_counted?: number
          card_terminal_system?: number
          cash_counted?: number
          cash_difference?: number
          cash_system?: number
          closed_by?: string | null
          coins_1?: number
          coins_10?: number
          coins_25?: number
          coins_5?: number
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          net_total?: number
          notes?: string | null
          total_expenses?: number
          total_income?: number
          transfers_counted?: number
          transfers_system?: number
        }
        Update: {
          azul_counted?: number
          azul_system?: number
          bills_100?: number
          bills_1000?: number
          bills_200?: number
          bills_2000?: number
          bills_50?: number
          bills_500?: number
          card_terminal_counted?: number
          card_terminal_system?: number
          cash_counted?: number
          cash_difference?: number
          cash_system?: number
          closed_by?: string | null
          coins_1?: number
          coins_10?: number
          coins_25?: number
          coins_5?: number
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          net_total?: number
          notes?: string | null
          total_expenses?: number
          total_income?: number
          transfers_counted?: number
          transfers_system?: number
        }
        Relationships: []
      }
      catalog_items: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          price: number
          sessions: number
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          price?: number
          sessions?: number
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          price?: number
          sessions?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_packages: {
        Row: {
          active: boolean
          created_at: string
          customer_id: string | null
          id: string
          invoice_id: string | null
          invoice_item_id: string | null
          package_name: string
          purchased_date: string
          total_sessions: number
          updated_at: string
          used_sessions: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          invoice_item_id?: string | null
          package_name: string
          purchased_date?: string
          total_sessions?: number
          updated_at?: string
          used_sessions?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          invoice_item_id?: string | null
          package_name?: string
          purchased_date?: string
          total_sessions?: number
          updated_at?: string
          used_sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_packages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_packages_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_packages_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          allergies: string | null
          birthday: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          allergies?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          allergies?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employee_date_overrides: {
        Row: {
          created_at: string
          date: string
          employee_name: string
          end_min: number | null
          id: string
          reason: string | null
          start_min: number | null
        }
        Insert: {
          created_at?: string
          date: string
          employee_name: string
          end_min?: number | null
          id?: string
          reason?: string | null
          start_min?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          employee_name?: string
          end_min?: number | null
          id?: string
          reason?: string | null
          start_min?: number | null
        }
        Relationships: []
      }
      employee_requests: {
        Row: {
          attachment_path: string | null
          created_at: string
          date: string
          employee_name: string | null
          end_date: string | null
          id: string
          info: string | null
          kind: string
          new_start_min: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attachment_path?: string | null
          created_at?: string
          date: string
          employee_name?: string | null
          end_date?: string | null
          id?: string
          info?: string | null
          kind: string
          new_start_min?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attachment_path?: string | null
          created_at?: string
          date?: string
          employee_name?: string | null
          end_date?: string | null
          id?: string
          info?: string | null
          kind?: string
          new_start_min?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employee_schedules: {
        Row: {
          created_at: string
          employee_name: string
          end_min: number | null
          id: string
          lunch_minutes: number
          lunch_start_min: number | null
          start_min: number | null
          updated_at: string
          weekday: number
          works: boolean
        }
        Insert: {
          created_at?: string
          employee_name: string
          end_min?: number | null
          id?: string
          lunch_minutes?: number
          lunch_start_min?: number | null
          start_min?: number | null
          updated_at?: string
          weekday: number
          works?: boolean
        }
        Update: {
          created_at?: string
          employee_name?: string
          end_min?: number | null
          id?: string
          lunch_minutes?: number
          lunch_start_min?: number | null
          start_min?: number | null
          updated_at?: string
          weekday?: number
          works?: boolean
        }
        Relationships: []
      }
      employee_settings: {
        Row: {
          active: boolean
          cabin: number | null
          color: string | null
          created_at: string
          max_clients: number | null
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          cabin?: number | null
          color?: string | null
          created_at?: string
          max_clients?: number | null
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          cabin?: number | null
          color?: string | null
          created_at?: string
          max_clients?: number | null
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      employee_time_off: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          employee_name: string
          id: string
          reason: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          employee_name: string
          id?: string
          reason?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          employee_name?: string
          id?: string
          reason?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          created_by: string | null
          date: string
          description: string | null
          id: string
          receipt_url: string | null
        }
        Insert: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          id?: string
          receipt_url?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string | null
          id?: string
          receipt_url?: string | null
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          active: boolean
          category: string | null
          cost_per_unit: number
          created_at: string
          id: string
          min_stock: number
          name: string
          per_client_rate: number
          sku: string | null
          stock: number
          supplier: string | null
          supplier_phone: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          cost_per_unit?: number
          created_at?: string
          id?: string
          min_stock?: number
          name: string
          per_client_rate?: number
          sku?: string | null
          stock?: number
          supplier?: string | null
          supplier_phone?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          cost_per_unit?: number
          created_at?: string
          id?: string
          min_stock?: number
          name?: string
          per_client_rate?: number
          sku?: string | null
          stock?: number
          supplier?: string | null
          supplier_phone?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          item_id: string | null
          item_name: string
          new_stock: number | null
          notes: string | null
          previous_stock: number | null
          qty: number
          sku: string | null
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          item_id?: string | null
          item_name: string
          new_stock?: number | null
          notes?: string | null
          previous_stock?: number | null
          qty: number
          sku?: string | null
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          item_id?: string | null
          item_name?: string
          new_stock?: number | null
          notes?: string | null
          previous_stock?: number | null
          qty?: number
          sku?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          catalog_item_id: string | null
          created_at: string
          id: string
          invoice_id: string
          is_package: boolean
          name: string
          package_sessions: number | null
          quantity: number
          total: number
          unit_price: number
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          is_package?: boolean
          name: string
          package_sessions?: number | null
          quantity?: number
          total?: number
          unit_price?: number
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          is_package?: boolean
          name?: string
          package_sessions?: number | null
          quantity?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_catalog_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          method: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id: string
          method: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          date: string
          id: string
          invoice_number: number
          notes: string | null
          sold_by: string | null
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          id?: string
          invoice_number?: number
          notes?: string | null
          sold_by?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          date?: string
          id?: string
          invoice_number?: number
          notes?: string | null
          sold_by?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          employee_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          employee_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          employee_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          agenda_edit: boolean
          caja: boolean
          clients_access: string
          created_at: string
          full_agenda: boolean
          history: boolean
          inventory: boolean
          reports: boolean
          sales: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          agenda_edit?: boolean
          caja?: boolean
          clients_access?: string
          created_at?: string
          full_agenda?: boolean
          history?: boolean
          inventory?: boolean
          reports?: boolean
          sales?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          agenda_edit?: boolean
          caja?: boolean
          clients_access?: string
          created_at?: string
          full_agenda?: boolean
          history?: boolean
          inventory?: boolean
          reports?: boolean
          sales?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_perm: { Args: { _perm: string; _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      set_my_color: { Args: { new_color: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "employee"
      swap_status: "pending" | "approved" | "rejected" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "employee"],
      swap_status: ["pending", "approved", "rejected", "cancelled"],
    },
  },
} as const
