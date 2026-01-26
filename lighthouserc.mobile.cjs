module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      settings: {
        onlyCategories: ['performance'],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/mobile',
    },
  },
};
