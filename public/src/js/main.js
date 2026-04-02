// Main entry point — imports all modules, exposes to window for onclick handlers
import state from './state.js';
import { toast, insEsc, showNotify, formatBytes, showProgress, hideProgress, handleApiError } from './utils.js';
import { checkAuth, showLogin, showApp, loginFacebook, logout, populatePages, selectPage, switchTab, initRouter } from './router.js';
import { initCompose, handleFiles, handleFile, renderImagePreviews, removeImage, submitPost, showPreview, closePreview, confirmPost, loadHistory, loadComposeTemplates, applyTemplate, loadTemplates, useTemplate, STYLE_GUIDE, onStyleChange, updateCharColor, saveDraftFromCompose, loadComposeDrafts, loadDraftToCompose, deleteDraftInline, generateAI, toggleAffiliate, initAlgoTips, showComments, setReplyTarget, sendReply, togglePromptLogs, loadPromptLogs, savePromptLog, copyLogFull, toggleTextOverlay, getOverlayText, generateAiImageAuto, generateAiImageSemi, confirmGenerateImage, acceptAiImage, rejectAiImage, closeAiPreview, loadAiImageTemplates, copyAiPrompt } from './compose.js';
import { loadAutoReplySettings, toggleAutoReplyPage, changeAutoReplyMode, changeAutoReplyTone, saveCustomTone, toggleSkipGreeting, loadAutoReplyHistory } from './comment.js';
import { initNotifications, loadNotifications, markNotifRead, markNotifSingleRead } from './notifications.js';

import * as schedule from './schedule.js';
import * as bulk from './bulk.js';
import * as bulkV2 from './bulk-v2.js';

// Expose ALL functions to window for onclick/onchange handlers in HTML
Object.assign(window, {
  // Utils
  toast, insEsc, showNotify, formatBytes, showProgress, hideProgress, handleApiError,
  // Router
  checkAuth, showLogin, showApp, loginFacebook, logout, populatePages, selectPage, switchTab,
  // Compose
  handleFiles, handleFile, renderImagePreviews, removeImage, submitPost, showPreview, closePreview, confirmPost,
  loadHistory, loadComposeTemplates, applyTemplate, loadTemplates, useTemplate,
  onStyleChange, updateCharColor, saveDraftFromCompose, loadComposeDrafts, loadDraftToCompose, deleteDraftInline,
  generateAI, toggleAffiliate, showComments, setReplyTarget, sendReply,
  togglePromptLogs, loadPromptLogs, savePromptLog, copyLogFull,
  toggleTextOverlay, getOverlayText, generateAiImageAuto, generateAiImageSemi, confirmGenerateImage,
  acceptAiImage, rejectAiImage, closeAiPreview, loadAiImageTemplates, copyAiPrompt,
  // Comment
  loadAutoReplySettings, toggleAutoReplyPage, changeAutoReplyMode, changeAutoReplyTone, saveCustomTone, toggleSkipGreeting, loadAutoReplyHistory,
  // Notifications
  loadNotifications, markNotifRead, markNotifSingleRead,
});

// Expose schedule/bulk module functions (dynamic — no need to list each)
for (const [key, val] of Object.entries(schedule)) {
  if (typeof val === 'function') window[key] = val;
}
for (const [key, val] of Object.entries(bulk)) {
  if (typeof val === 'function') window[key] = val;
}
for (const [key, val] of Object.entries(bulkV2)) {
  if (typeof val === 'function') window[key] = val;
}

// --- Init ---
initCompose();
initAlgoTips();
if (typeof schedule.initScheduleTime === 'function') schedule.initScheduleTime();
if (typeof bulk.initBulk === 'function') bulk.initBulk();
initNotifications();
initRouter();
