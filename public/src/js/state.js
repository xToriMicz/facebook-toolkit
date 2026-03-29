// Shared application state — all modules import this object
const state = {
  uploadedImageUrl: null,
  uploadedImageData: null,
  currentUser: null,
  selectedPage: null,
  userPages: [],
  uploadedImages: [],
  MAX_IMG_PX: 2048,
  COMPRESS_Q: 0.8,
  // Calendar
  calYear: null,
  calMonth: null,
  calPosts: [],
  calScheduled: [],
  // Logs
  allLogs: [],
  currentLogFilter: 'all',
  // Schedule edit
  editingScheduleId: null,
  // Comments
  currentCommentPostId: null,
  replyTargetId: null,
  // Bulk
  _bulkResults: [],
  // Insights
  insData: {},
  // Tips
  tipIdx: 0,
  // Progress timers
  _progressTimers: {},
};

export default state;
