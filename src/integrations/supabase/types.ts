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
      ai_predictions: {
        Row: {
          created_at: string
          features: Json
          fixture_id: number
          id: string
          market: string
          market_sub_type: string | null
          probability: number
          result: Json | null
          round_id: string | null
          score: number
          veto_reason: string | null
          vetoed: boolean
        }
        Insert: {
          created_at?: string
          features?: Json
          fixture_id: number
          id?: string
          market: string
          market_sub_type?: string | null
          probability: number
          result?: Json | null
          round_id?: string | null
          score: number
          veto_reason?: string | null
          vetoed?: boolean
        }
        Update: {
          created_at?: string
          features?: Json
          fixture_id?: number
          id?: string
          market?: string
          market_sub_type?: string | null
          probability?: number
          result?: Json | null
          round_id?: string | null
          score?: number
          veto_reason?: string | null
          vetoed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_predictions_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "ai_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_rounds: {
        Row: {
          api_calls: number
          created_at: string
          fixtures_analyzed: number
          id: string
          notes: string | null
          ran_at: string
          slot: string
          status: string
          updated_at: string
          weights_version: number
        }
        Insert: {
          api_calls?: number
          created_at?: string
          fixtures_analyzed?: number
          id?: string
          notes?: string | null
          ran_at?: string
          slot: string
          status?: string
          updated_at?: string
          weights_version?: number
        }
        Update: {
          api_calls?: number
          created_at?: string
          fixtures_analyzed?: number
          id?: string
          notes?: string | null
          ran_at?: string
          slot?: string
          status?: string
          updated_at?: string
          weights_version?: number
        }
        Relationships: []
      }
      ai_selftest: {
        Row: {
          backtest_accuracy: number | null
          calibration_brier: number | null
          created_at: string
          details: Json
          id: string
          passed: boolean
          ran_at: string
          veto_rate: number | null
          weight_drift: number | null
        }
        Insert: {
          backtest_accuracy?: number | null
          calibration_brier?: number | null
          created_at?: string
          details?: Json
          id?: string
          passed?: boolean
          ran_at?: string
          veto_rate?: number | null
          weight_drift?: number | null
        }
        Update: {
          backtest_accuracy?: number | null
          calibration_brier?: number | null
          created_at?: string
          details?: Json
          id?: string
          passed?: boolean
          ran_at?: string
          veto_rate?: number | null
          weight_drift?: number | null
        }
        Relationships: []
      }
      ai_tickets: {
        Row: {
          composite_score: number
          created_at: string
          fixtures: Json
          id: string
          round_id: string | null
          settled_at: string | null
          status: string
          ticket_type: string
          updated_at: string
        }
        Insert: {
          composite_score: number
          created_at?: string
          fixtures?: Json
          id?: string
          round_id?: string | null
          settled_at?: string | null
          status?: string
          ticket_type: string
          updated_at?: string
        }
        Update: {
          composite_score?: number
          created_at?: string
          fixtures?: Json
          id?: string
          round_id?: string | null
          settled_at?: string | null
          status?: string
          ticket_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_tickets_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "ai_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_weights: {
        Row: {
          accuracy_30d: number | null
          created_at: string
          id: string
          reason: string | null
          roi_30d: number | null
          version: number
          weights: Json
        }
        Insert: {
          accuracy_30d?: number | null
          created_at?: string
          id?: string
          reason?: string | null
          roi_30d?: number | null
          version: number
          weights: Json
        }
        Update: {
          accuracy_30d?: number | null
          created_at?: string
          id?: string
          reason?: string | null
          roi_30d?: number | null
          version?: number
          weights?: Json
        }
        Relationships: []
      }
      api_cache: {
        Row: {
          created_at: string | null
          data: Json
          expires_at: string
          key: string
        }
        Insert: {
          created_at?: string | null
          data: Json
          expires_at: string
          key: string
        }
        Update: {
          created_at?: string | null
          data?: Json
          expires_at?: string
          key?: string
        }
        Relationships: []
      }
      assistant_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      auto_tickets: {
        Row: {
          accuracy: number | null
          away: string
          away_logo: string | null
          created_at: string
          fixture_id: number
          graded_at: string | null
          greens: number
          home: string
          home_logo: string | null
          id: string
          kickoff: string
          league: string | null
          meta: Json
          picks: Json
          reds: number
          result: Json | null
          result_snapshot: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          away: string
          away_logo?: string | null
          created_at?: string
          fixture_id: number
          graded_at?: string | null
          greens?: number
          home: string
          home_logo?: string | null
          id?: string
          kickoff: string
          league?: string | null
          meta?: Json
          picks?: Json
          reds?: number
          result?: Json | null
          result_snapshot?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          away?: string
          away_logo?: string | null
          created_at?: string
          fixture_id?: number
          graded_at?: string | null
          greens?: number
          home?: string
          home_logo?: string | null
          id?: string
          kickoff?: string
          league?: string | null
          meta?: Json
          picks?: Json
          reds?: number
          result?: Json | null
          result_snapshot?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      betano_tickets: {
        Row: {
          created_at: string
          data: Json
          id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      fechamentos: {
        Row: {
          checked_at: string | null
          created_at: string
          device_id: string
          games: Json
          id: string
          name: string
          summary: Json
          target_date: string
          tickets: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          device_id: string
          games?: Json
          id?: string
          name: string
          summary?: Json
          target_date: string
          tickets?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          device_id?: string
          games?: Json
          id?: string
          name?: string
          summary?: Json
          target_date?: string
          tickets?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      triagem_records: {
        Row: {
          ceiling: number
          created_at: string
          fixture_id: number
          graded_at: string | null
          id: string
          kickoff: string | null
          league: string | null
          market_type: string
          match_name: string
          passed: boolean
          predicted_value: string
          probability: number
          reason: Json
          result_score: string | null
          score_confidence: number
          status: string
        }
        Insert: {
          ceiling?: number
          created_at?: string
          fixture_id: number
          graded_at?: string | null
          id?: string
          kickoff?: string | null
          league?: string | null
          market_type: string
          match_name: string
          passed?: boolean
          predicted_value: string
          probability?: number
          reason?: Json
          result_score?: string | null
          score_confidence?: number
          status?: string
        }
        Update: {
          ceiling?: number
          created_at?: string
          fixture_id?: number
          graded_at?: string | null
          id?: string
          kickoff?: string | null
          league?: string | null
          market_type?: string
          match_name?: string
          passed?: boolean
          predicted_value?: string
          probability?: number
          reason?: Json
          result_score?: string | null
          score_confidence?: number
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
