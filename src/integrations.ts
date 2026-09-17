export type IntegrationId = 'gmail' | 'instagram' | 'tiktok' | 'facebook' | 'whatsapp' | 'google-drive' | 'google-calendar' | 'notion' | 'github' | 'stripe' | 'canva' | 'supabase' | 'vercel';

export type Integration = { id: IntegrationId; name: string; description: string; category: string; available: boolean; connected?: boolean };

export const integrations: Integration[] = [
 { id:'gmail', name:'Gmail', description:'Email, drafts, and inbox workflows', category:'Communication', available:true },
 { id:'instagram', name:'Instagram', description:'Professional account publishing and insights', category:'Social', available:true },
 { id:'tiktok', name:'TikTok', description:'Content publishing and available analytics', category:'Social', available:true },
 { id:'facebook', name:'Facebook', description:'Pages, publishing, comments, and messaging', category:'Social', available:true },
 { id:'whatsapp', name:'WhatsApp Business', description:'Business messaging and customer conversations', category:'Communication', available:true },
 { id:'google-drive', name:'Google Drive', description:'Files, folders, and document workflows', category:'Productivity', available:true },
 { id:'google-calendar', name:'Google Calendar', description:'Events, scheduling, and reminders', category:'Productivity', available:true },
 { id:'notion', name:'Notion', description:'Pages, databases, and knowledge workflows', category:'Productivity', available:true },
 { id:'github', name:'GitHub', description:'Repositories, code, issues, and pull requests', category:'Developer', available:true },
 { id:'stripe', name:'Stripe', description:'Customers, payments, and subscriptions', category:'Business', available:true },
 { id:'canva', name:'Canva', description:'Design workflows and creative assets', category:'Creative', available:true },
 { id:'supabase', name:'Supabase', description:'Database, auth, storage, and backend', category:'Developer', available:true },
 { id:'vercel', name:'Vercel', description:'Deployments, domains, and project management', category:'Developer', available:true }
];
