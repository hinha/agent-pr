/**
 * Mock for mcporter CLI tool
 * Used by mcpGithubService for GitHub operations via MCP
 */

const mockData = {
  // Mock data for list_pull_requests
  list_pull_requests: [
    {
      id: 123456,
      number: 1,
      title: 'Test PR',
      html_url: 'https://github.com/owner/repo/pull/1',
      user: { login: 'testuser' },
      created_at: '2024-01-01T00:00:00Z',
      body: 'Test description',
      base: { ref: 'main' },
      head: { ref: 'feature-branch', sha: 'abc123' },
      state: 'open'
    }
  ],

  // Mock data for get_pull_request_files
  get_pull_request_files: [
    {
      filename: 'src/index.js',
      blob_url: 'https://github.com/owner/repo/blob/abc123/src/index.js',
      raw_url: 'https://github.com/owner/repo/raw/abc123/src/index.js',
      additions: 10,
      deletions: 5,
      changes: 15,
      status: 'modified',
      patch: '@@ -1,5 +1,10 @@\n public class Test {\n-    int old = 0;\n+    int newValue = 1;\n }'
    }
  ],

  // Mock data for create_pull_request_review
  create_pull_request_review: {
    id: 789012,
    html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-789012',
    submitted_at: '2024-01-01T00:00:00Z',
    state: 'COMMENT'
  },

  // Mock data for update_pull_request
  update_pull_request: {
    id: 123456,
    state: 'closed'
  },

  // Mock data for get_pull_request_reviews
  get_pull_request_reviews: [
    {
      id: 789012,
      state: 'CHANGES_REQUESTED',
      body: 'Please make changes',
      user: { login: 'reviewer' },
      submitted_at: '2024-01-01T00:00:00Z',
      commit_id: 'old123',
      comments: []
    }
  ],

  // Mock data for get_pull_request_comments
  get_pull_request_comments: []
};

/**
 * Get mock data for a specific MCP method
 */
function getMockDataForMethod(method) {
  return mockData[method] || {};
}

module.exports = {
  call: jest.fn((serverMethod, options, callback) => {
    // Simulate async behavior
    setImmediate(() => {
      const mockResponse = getMockDataForMethod(serverMethod);
      callback(null, { stdout: JSON.stringify(mockResponse) });
    });
  }),

  // Helper to set mock data for tests
  __setMockData: function(method, data) {
    mockData[method] = data;
  },

  // Helper to reset all mock data
  __resetMockData: function() {
    Object.keys(mockData).forEach(key => {
      delete mockData[key];
    });
  },

  getMockData: function(method) {
    return mockData[method];
  }
};
