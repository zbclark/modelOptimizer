const COURSE_HISTORY_REGRESSION = {
  "6": {
    "slope": -2.9499471277248888,
    "pValue": 0.0000020149212760500745
  },
  "12": {
    "slope": -5.381344994887318,
    "pValue": 5.027533944712559e-11
  },
  "21": {
    "slope": -1.2133482129250956,
    "pValue": 0.15870370594050387
  },
  "513": {
    "slope": -4.416275951939989,
    "pValue": 0.00007413247547050084
  },
  "752": {
    "slope": -1.8447598786549433,
    "pValue": 0.016142659832632633
  },
  "776": {
    "slope": -0.33544069592176845,
    "pValue": 0.6172683979708227
  },
  "meta": {
    "generatedAt": "2026-03-02T19:53:39.403Z",
    "eventId": "6",
    "season": 2026,
    "mode": "pre_event",
    "courseNum": "6",
    "courseNameKey": "WAIALAE_COUNTRY_CLUB",
    "templateKey": "WAIALAE_COUNTRY_CLUB",
    "tours": [
      "pga"
    ],
    "eventScope": {
      "eventId": "6",
      "similarEventIds": [
        "12",
        "21",
        "493",
        "549",
        "13"
      ],
      "puttingEventIds": [
        "493",
        "549",
        "12",
        "13",
        "27",
        "533"
      ]
    },
    "yearScope": {
      "lastSixYears": [
        2026,
        2025,
        2024,
        2023,
        2022,
        2021
      ],
      "recentMonths": [
        "2026-3",
        "2026-2",
        "2026-1",
        "2025-12"
      ]
    }
  }
};

function getCourseHistoryRegression(courseNum) {
  if (courseNum === null || courseNum === undefined) return null;
  const key = String(courseNum).trim();
  return COURSE_HISTORY_REGRESSION[key] || null;
}

module.exports = { COURSE_HISTORY_REGRESSION, getCourseHistoryRegression };
