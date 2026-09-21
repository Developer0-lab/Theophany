export type IntegrationId = 'gmail' | 'instagram' | 'tiktok' | 'facebook' | 'whatsapp' | 'google-drive' | 'google-calendar' | 'notion' | 'stripe' | 'pesapal' | 'canva' | 'domains' | 'youtube' | 'google-ads' | 'meta-ads' | 'analytics';
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
 { id:'stripe', name:'Stripe', description:'International payments and subscriptions', category:'Business', available:true },
 { id:'pesapal', name:'PesaPal', description:'East African payments and customer checkout', category:'Business', available:true },
 { id:'canva', name:'Canva', description:'Design workflows and creative assets', category:'Creative', available:true },
 { id:'domains', name:'Domains', description:'Domain availability, DNS, and production domain management', category:'Business', available:true },
 { id:'youtube', name:'YouTube', description:'Video publishing, channel management, and analytics', category:'Social', available:true },
 { id:'google-ads', name:'Google Ads', description:'Campaign creation, publishing, and performance analytics', category:'Advertising', available:true },
 { id:'meta-ads', name:'Meta Ads', description:'Facebook and Instagram advertising campaigns and analytics', category:'Advertising', available:true },
 { id:'analytics', name:'Analytics', description:'Website traffic, conversion, and campaign measurement', category:'Analytics', available:true }
];
