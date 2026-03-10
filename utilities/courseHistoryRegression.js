const COURSE_HISTORY_REGRESSION = {
  "11": {
    "slope": -2.243949852013001,
    "pValue": 0.0011812015523275932
  },
  "12": {
    "slope": -5.381344994887318,
    "pValue": 5.027533944712559e-11
  },
  "21": {
    "slope": -1.2133482129250956,
    "pValue": 0.15870370594050387
  },
  "510": {
    "slope": -1.5199808712921337,
    "pValue": 0.011399679864861678
  },
  "665": {
    "slope": -0.9414115804834621,
    "pValue": 0.26862406139293826
  },
  "752": {
    "slope": -1.8447598786549433,
    "pValue": 0.016142659832632633
  },
  "meta": {
    "generatedAt": "2026-03-10T17:03:56-05:00",
    "eventId": "11",
    "season": 2026,
    "mode": "pre_event",
    "courseNum": "11",
    "courseNameKey": "TPC_SAWGRASS",
    "templateKey": "TPC_SAWGRASS",
    "tours": [
      "pga"
    ],
    "eventScope": {
      "eventId": "11",
      "similarEventIds": [
        "21",
        "475",
        "12",
        "13"
      ],
      "puttingEventIds": [
        "3",
        "475"
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
