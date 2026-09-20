import { Target, TrendingUp, AlertCircle, Scan, Trophy, LayoutDashboard, Zap, FlaskConical, Radio, Crown, ClipboardList, Star, Bot, Filter, Layers } from "lucide-react";
import { setActiveSection, useActiveSection } from "@/lib/active-section";

export const SECTIONS: { id: string; label: string; icon: string; lucide: any; href?: string }[] = [
  { id: "dashboard-clayton", label: "Dashboard Clayton", icon: "💎", lucide: LayoutDashboard },
  { id: "fechamentos", label: "Fechamento Betano 3/4", icon: "🧩", lucide: Layers, href: "/fechamentos" },
  { id: "triagem", label: "Triagem", icon: "🔎", lucide: Filter, href: "/triagem" },
  { id: "multiplas", label: "Múltiplas Populares", icon: "🎫", lucide: Trophy },
  { id: "bingao", label: "Bingão", icon: "🎯", lucide: Target },

  { id: "loteca", label: "Lotéca IA", icon: "🎟️", lucide: ClipboardList },
  { id: "radar", label: "Radar OneOption", icon: "⚡", lucide: Zap },
  { id: "beta", label: "Beta", icon: "🧪", lucide: FlaskConical },
  { id: "alfha", label: "Alfha", icon: "⚡", lucide: Zap },
  { id: "artilheiros", label: "Artilheiros", icon: "👑", lucide: Crown },
  { id: "especiais-betano", label: "Especiais Betano", icon: "⭐", lucide: Star },
  { id: "diagnostico", label: "Assistente IA", icon: "🧠", lucide: Bot },
  { id: "auditoria", label: "Bilhetes Auto", icon: "🤖", lucide: Radio },
];
