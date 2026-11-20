// P10: the ONLY events the first-party analytics accepts, shared by the browser (src/ui/analytics.js), the
// collector (api/collect.js), the admin Stats view and the SQL CHECK in 0006_analytics.sql (a test keeps them equal).
// No free text, no referrer, no path: the event name is the whole message.
export const ANALYTICS_EVENTS = ['pageview_classic', 'pageview_explore', 'chat_open', 'chat_message', 'contact_submit_ok', 'voice_used', 'cv_download', 'lang_ur', 'a11y_menu_used'];
export const ANALYTICS_BODY_MAX = 200;
export const ANALYTICS_DAILY_CAP = 5000;
export const STATS_DAYS = 14;
