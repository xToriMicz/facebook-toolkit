// Main entry point — imports all modules, exposes to window for onclick handlers
import state from './state.js';
import { toast, insEsc, showNotify, formatBytes, showProgress, hideProgress, handleApiError } from './utils.js';
import { checkAuth, showLogin, showApp, loginFacebook, logout, populatePages, selectPage, switchTab, initRouter } from './router.js';
import { initCompose, handleFiles, handleFile, renderImagePreviews, removeImage, submitPost, showPreview, closePreview, confirmPost, loadHistory, loadComposeTemplates, applyTemplate, loadTemplates, useTemplate, STYLE_GUIDE, onStyleChange, updateCharColor, saveDraftFromCompose, loadComposeDrafts, loadDraftToCompose, deleteDraftInline, generateAI, toggleAffiliate, initAlgoTips, showComments, setReplyTarget, sendReply, togglePromptLogs, loadPromptLogs, savePromptLog, copyLogFull, toggleTextOverlay, getOverlayText, generateAiImageAuto, generateAiImageSemi, confirmGenerateImage, acceptAiImage, rejectAiImage, closeAiPreview, loadAiImageTemplates, copyAiPrompt } from './compose.js';
import { loadAutoReplySettings, toggleAutoReplyPage, changeAutoReplyMode, loadAutoReplyHistory } from './comment.js';
import * as schedule from './schedule.js';
import * as bulk from './bulk.js';

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
  loadAutoReplySettings, toggleAutoReplyPage, changeAutoReplyMode, loadAutoReplyHistory,
});

// Expose schedule module functions
for (const [key, val] of Object.entries(schedule)) {
  if (typeof val === 'function') window[key] = val;
}

// Expose bulk module functions
for (const [key, val] of Object.entries(bulk)) {
  if (typeof val === 'function') window[key] = val;
}

// Also expose _bulkUpdateSchedule for inline onchange
window._bulkUpdateSchedule = bulk._bulkUpdateSchedule || function(idx, newDate, newTime) {
  if (idx < 0 || idx >= state._bulkResults.length) return;
  var r = state._bulkResults[idx];
  var d = r.scheduled_at ? new Date(r.scheduled_at) : new Date();
  if (newDate) { var parts = newDate.split('-'); d.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])); }
  if (newTime) { var tp = newTime.split(':'); d.setHours(parseInt(tp[0]), parseInt(tp[1]), 0, 0); }
  r.scheduled_at = d.toISOString();
};

// --- Init ---
initCompose();
initAlgoTips();
if (typeof schedule.initScheduleTime === 'function') schedule.initScheduleTime();
if (typeof bulk.initBulk === 'function') bulk.initBulk();
initRouter();
