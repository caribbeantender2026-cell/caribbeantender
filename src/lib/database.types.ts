// Generated from the linked Supabase project by scripts/generate-database-types.ts. Do not edit by hand.
// Regenerate with `pnpm types` after applying a migration.
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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          entity_id: string
          entity_type: string
          id: number
          metadata: Json
          occurred_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          entity_id: string
          entity_type: string
          id?: never
          metadata?: Json
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          entity_id?: string
          entity_type?: string
          id?: never
          metadata?: Json
          occurred_at?: string
        }
        Relationships: []
      }
      bid_documents: {
        Row: {
          bid_id: string
          document_role: Database["public"]["Enums"]["document_role"]
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          bid_id: string
          document_role?: Database["public"]["Enums"]["document_role"]
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
        }
        Update: {
          bid_id?: string
          document_role?: Database["public"]["Enums"]["document_role"]
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_documents_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id"]
          },
        ]
      }
      bids: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          status: Database["public"]["Enums"]["bid_status"]
          submitted_at: string
          supplier_id: string
          tender_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          status?: Database["public"]["Enums"]["bid_status"]
          submitted_at: string
          supplier_id: string
          tender_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          status?: Database["public"]["Enums"]["bid_status"]
          submitted_at?: string
          supplier_id?: string
          tender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bids_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          address: string | null
          company_address: string | null
          company_name: string | null
          contact_email: string | null
          created_at: string
          description: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          company_address?: string | null
          company_name?: string | null
          contact_email?: string | null
          created_at?: string
          description?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          company_address?: string | null
          company_name?: string | null
          contact_email?: string | null
          created_at?: string
          description?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          code: string | null
          examples: string | null
          id: number
          is_active: boolean
          name: string
          procurement_type: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          code?: string | null
          examples?: string | null
          id?: never
          is_active?: boolean
          name: string
          procurement_type?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          code?: string | null
          examples?: string | null
          id?: never
          is_active?: boolean
          name?: string
          procurement_type?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      company_names: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          company_name: string | null
          user_id: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          company_name?: string | null
          user_id: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          company_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_names_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          created_at: string
          entity_id: string
          id: number
          provider_message_id: string | null
          recipient: string
          sent_at: string | null
          status: string
          type: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          id?: never
          provider_message_id?: string | null
          recipient: string
          sent_at?: string | null
          status?: string
          type: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          id?: never
          provider_message_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      form_definitions: {
        Row: {
          audience: Database["public"]["Enums"]["account_type"]
          created_at: string
          download_path: string | null
          is_active: boolean
          is_draft: boolean
          key: string
          schema: Json
          title: string
          version: number
        }
        Insert: {
          audience: Database["public"]["Enums"]["account_type"]
          created_at?: string
          download_path?: string | null
          is_active?: boolean
          is_draft?: boolean
          key: string
          schema: Json
          title: string
          version: number
        }
        Update: {
          audience?: Database["public"]["Enums"]["account_type"]
          created_at?: string
          download_path?: string | null
          is_active?: boolean
          is_draft?: boolean
          key?: string
          schema?: Json
          title?: string
          version?: number
        }
        Relationships: []
      }
      form_submissions: {
        Row: {
          attached_to_id: string | null
          attached_to_type: string | null
          created_at: string
          data: Json
          form_key: string
          form_version: number
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          attached_to_id?: string | null
          attached_to_type?: string | null
          created_at?: string
          data?: Json
          form_key: string
          form_version: number
          id?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          attached_to_id?: string | null
          attached_to_type?: string | null
          created_at?: string
          data?: Json
          form_key?: string
          form_version?: number
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_form_key_form_version_fkey"
            columns: ["form_key", "form_version"]
            isOneToOne: false
            referencedRelation: "form_definitions"
            referencedColumns: ["key", "version"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          tender_alerts: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          tender_alerts?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          tender_alerts?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          accepted_terms_at: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          company_address: string | null
          company_name: string | null
          created_at: string
          description: string | null
          email: string | null
          full_name: string
          id: string
          industry_category: string | null
          is_active: boolean
          onboarding_completed: Json
          phone: string | null
          updated_at: string
        }
        Insert: {
          accepted_terms_at?: string | null
          account_type?: Database["public"]["Enums"]["account_type"] | null
          company_address?: string | null
          company_name?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          full_name: string
          id: string
          industry_category?: string | null
          is_active?: boolean
          onboarding_completed?: Json
          phone?: string | null
          updated_at?: string
        }
        Update: {
          accepted_terms_at?: string | null
          account_type?: Database["public"]["Enums"]["account_type"] | null
          company_address?: string | null
          company_name?: string | null
          created_at?: string
          description?: string | null
          email?: string | null
          full_name?: string
          id?: string
          industry_category?: string | null
          is_active?: boolean
          onboarding_completed?: Json
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      staff_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["staff_role"]
          user_id?: string
        }
        Relationships: []
      }
      subscription_events: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          event_type: string
          id: string
          metadata: Json | null
          occurred_at: string
          provider: string
          provider_event_id: string | null
          status: string
          subscription_plan: string | null
          supplier_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          provider?: string
          provider_event_id?: string | null
          status: string
          subscription_plan?: string | null
          supplier_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          provider?: string
          provider_event_id?: string | null
          status?: string
          subscription_plan?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          billing_interval: string
          created_at: string
          currency: string
          description: string | null
          id: string
          interval_count: number
          is_active: boolean
          plan_code: string
          plan_name: string
          price: number
          provider_price_id: string | null
          provider_product_id: string | null
          updated_at: string
        }
        Insert: {
          billing_interval: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          plan_code: string
          plan_name: string
          price: number
          provider_price_id?: string | null
          provider_product_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_interval?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          plan_code?: string
          plan_name?: string
          price?: number
          provider_price_id?: string | null
          provider_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          payment_customer_id: string | null
          payment_subscription_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          subscription_plan: string | null
          subscription_started_at: string | null
          supplier_id: string
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          payment_customer_id?: string | null
          payment_subscription_id?: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          subscription_plan?: string | null
          subscription_started_at?: string | null
          supplier_id: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          payment_customer_id?: string | null
          payment_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          subscription_plan?: string | null
          subscription_started_at?: string | null
          supplier_id?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_profiles: {
        Row: {
          address: string | null
          category_id: number | null
          company_address: string | null
          company_name: string | null
          contact_email: string | null
          created_at: string
          description: string | null
          industry_category: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          category_id?: number | null
          company_address?: string | null
          company_name?: string | null
          contact_email?: string | null
          created_at?: string
          description?: string | null
          industry_category?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          category_id?: number | null
          company_address?: string | null
          company_name?: string | null
          contact_email?: string | null
          created_at?: string
          description?: string | null
          industry_category?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_profiles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_documents: {
        Row: {
          document_role: Database["public"]["Enums"]["document_role"]
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tender_id: string
          uploaded_at: string
        }
        Insert: {
          document_role?: Database["public"]["Enums"]["document_role"]
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          tender_id: string
          uploaded_at: string
        }
        Update: {
          document_role?: Database["public"]["Enums"]["document_role"]
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          tender_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_documents_tender_id_fkey"
            columns: ["tender_id"]
            isOneToOne: false
            referencedRelation: "tenders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenders: {
        Row: {
          awarded_at: string | null
          awarded_bid_id: string | null
          business_id: string
          cancelled_at: string | null
          cancelled_reason: string | null
          category_id: number | null
          closed_at: string | null
          closes_at: string
          created_at: string
          description: string
          id: string
          published_at: string | null
          status: Database["public"]["Enums"]["tender_status"]
          title: string
          updated_at: string
        }
        Insert: {
          awarded_at?: string | null
          awarded_bid_id?: string | null
          business_id: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          category_id?: number | null
          closed_at?: string | null
          closes_at: string
          created_at?: string
          description: string
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title: string
          updated_at?: string
        }
        Update: {
          awarded_at?: string | null
          awarded_bid_id?: string | null
          business_id?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          category_id?: number | null
          closed_at?: string | null
          closes_at?: string
          created_at?: string
          description?: string
          id?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["tender_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenders_awarded_bid_fkey"
            columns: ["awarded_bid_id", "id"]
            isOneToOne: false
            referencedRelation: "bids"
            referencedColumns: ["id", "tender_id"]
          },
          {
            foreignKeyName: "tenders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "business_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tenders_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      business_names_public: {
        Row: {
          company_name: string | null
          user_id: string | null
        }
        Insert: {
          company_name?: string | null
          user_id?: string | null
        }
        Update: {
          company_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_names_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_names_public: {
        Row: {
          company_name: string | null
          user_id: string | null
        }
        Insert: {
          company_name?: string | null
          user_id?: string | null
        }
        Update: {
          company_name?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_names_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_cancel_tender: {
        Args: { reason: string; tender_id: string }
        Returns: undefined
      }
      admin_list_tenders: {
        Args: {
          page_offset?: number
          page_size?: number
          status_filter?: Database["public"]["Enums"]["tender_status"]
        }
        Returns: {
          bid_count: number
          business_id: string
          business_name: string
          cancelled_at: string
          cancelled_reason: string
          category_name: string
          closed_at: string
          closes_at: string
          published_at: string
          status: Database["public"]["Enums"]["tender_status"]
          tender_id: string
          title: string
        }[]
      }
      admin_list_users: {
        Args: { page_offset?: number; page_size?: number; search?: string }
        Returns: {
          business_name: string
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          last_sign_in_at: string
          staff_role: Database["public"]["Enums"]["staff_role"]
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          supplier_name: string
          trial_ends_at: string
          user_id: string
        }[]
      }
      admin_set_user_active: {
        Args: { is_active: boolean; user_id: string }
        Returns: undefined
      }
      award_tender: {
        Args: { bid_id: string; tender_id: string }
        Returns: undefined
      }
      cancel_tender: {
        Args: { reason: string; tender_id: string }
        Returns: undefined
      }
      due_emails: {
        Args: { batch_size?: number }
        Returns: {
          details: Json
          entity_id: string
          recipient: string
          type: string
        }[]
      }
      extend_tender_closing_time: {
        Args: { new_closes_at: string; tender_id: string }
        Returns: undefined
      }
      notifications_cron_secret: { Args: never; Returns: string }
      publish_tender: { Args: { tender_id: string }; Returns: string }
      read_tender_bids: {
        Args: { tender_id: string }
        Returns: {
          amount: number
          bid_id: string
          currency: string
          documents: Json
          proposal_form: Json
          status: Database["public"]["Enums"]["bid_status"]
          submitted_at: string
          supplier_company_name: string
          supplier_id: string
        }[]
      }
      record_onboarding_completed: {
        Args: {
          completed_account_type: Database["public"]["Enums"]["account_type"]
        }
        Returns: undefined
      }
      request_document_download: {
        Args: { document_id: string }
        Returns: Json
      }
      submit_bid: {
        Args: {
          amount: number
          bid_id: string
          proposal_form_submission_id?: string
          tender_id: string
        }
        Returns: string
      }
    }
    Enums: {
      account_type: "business" | "supplier"
      bid_status: "submitted" | "awarded" | "unsuccessful" | "tender_cancelled"
      document_role: "requirements_form" | "proposal" | "supporting"
      staff_role: "owner" | "admin" | "support"
      subscription_status: "trial" | "active" | "expired" | "cancelled"
      tender_status: "draft" | "open" | "closed" | "awarded" | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      account_type: ["business", "supplier"],
      bid_status: ["submitted", "awarded", "unsuccessful", "tender_cancelled"],
      document_role: ["requirements_form", "proposal", "supporting"],
      staff_role: ["owner", "admin", "support"],
      subscription_status: ["trial", "active", "expired", "cancelled"],
      tender_status: ["draft", "open", "closed", "awarded", "cancelled"],
    },
  },
} as const
