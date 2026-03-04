const COURSE_HISTORY_REGRESSION = {
  "4": {
    "slope": -3.728545546250211,
    "pValue": 0.000005674069373906576
  },
  "5": {
    "slope": -3.492512011192498,
    "pValue": 0.0000019082100992662276
  },
  "9": {
    "slope": -6.089157464565899,
    "pValue": 3.410605131648481e-13
  },
  "14": {
    "slope": -2.8517597381870528,
    "pValue": 0.00148752051767298
  },
  "23": {
    "slope": -4.762126390052064,
    "pValue": 5.075371234397608e-10
  },
  "43": {
    "slope": 0,
    "pValue": 0.9999999989999999
  },
  "104": {
    "slope": -1.0273694002417921,
    "pValue": 0.010997696917960376
  },
  "241": {
    "slope": 0,
    "pValue": 0.9999999989999999
  },
  "500": {
    "slope": -4.239915597019708,
    "pValue": 2.5306365891708538e-8
  },
  "872": {
    "slope": -13.496302422813246,
    "pValue": 1.1102230246251565e-15
  },
  "939": {
    "slope": 0,
    "pValue": 0.9999999989999999
  },
  "meta": {
    "generatedAt": "2026-03-03T22:15:21.214Z",
    "eventId": "7",
    "season": 2026,
    "mode": "pre_event",
    "courseNum": [
      "500",
      "939"
    ],
    "courseNameKey": "THE_RIVIERA_COUNTRY_CLUB",
    "templateKey": "THE_RIVIERA_COUNTRY_CLUB",
    "tours": [
      "pga"
    ],
    "eventScope": {
      "eventId": "7",
      "similarEventIds": [
        "14",
        "538",
        "33",
        "480",
        "9",
        "536",
        "23"
      ],
      "puttingEventIds": [
        "4",
        "5",
        "26"
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
