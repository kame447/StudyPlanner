// Synthetic fixture copied verbatim from the Issue #488 campaign fixture (exam-student-fixture-20261008.json).
export default {
  "schemaVersion": 1,
  "persona": {
    "id": "exam-student-grade12",
    "name": "高校3年生・大学受験生",
    "timezone": "Asia/Tokyo",
    "weekStartDate": "2026-10-12",
    "weekEndDate": "2026-10-18",
    "accountType": "synthetic-test-only"
  },
  "rules": {
    "sleep": {
      "start": "23:30",
      "end": "06:30"
    },
    "maximumNewStudyMinutesPerDay": {
      "mon": 180,
      "tue": 180,
      "wed": 180,
      "thu": 180,
      "fri": 180,
      "sat": 300,
      "sun": 240
    },
    "studySessionTargetMinutes": {
      "min": 30,
      "max": 60
    },
    "normalDays": 6,
    "reserveDay": 7,
    "avoidExistingPlans": true
  },
  "existingEvents": [
    {
      "id": "exam-event-01",
      "date": "2026-10-12",
      "title": "学校・登校から下校まで",
      "startTime": "08:20",
      "endTime": "15:40",
      "kind": "school_day",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-02",
      "date": "2026-10-13",
      "title": "学校・登校から下校まで",
      "startTime": "08:20",
      "endTime": "15:40",
      "kind": "school_day",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-03",
      "date": "2026-10-14",
      "title": "学校・登校から下校まで",
      "startTime": "08:20",
      "endTime": "15:40",
      "kind": "school_day",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-04",
      "date": "2026-10-15",
      "title": "学校・登校から下校まで",
      "startTime": "08:20",
      "endTime": "15:40",
      "kind": "school_day",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-05",
      "date": "2026-10-16",
      "title": "学校・登校から下校まで",
      "startTime": "08:20",
      "endTime": "15:40",
      "kind": "school_day",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-06",
      "date": "2026-10-12",
      "title": "部活動",
      "startTime": "16:00",
      "endTime": "18:00",
      "kind": "club",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-07",
      "date": "2026-10-14",
      "title": "部活動",
      "startTime": "16:00",
      "endTime": "18:00",
      "kind": "club",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-08",
      "date": "2026-10-13",
      "title": "数学補講",
      "startTime": "16:00",
      "endTime": "17:30",
      "kind": "remedial_class",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-09",
      "date": "2026-10-13",
      "title": "塾・数学英語",
      "startTime": "19:00",
      "endTime": "21:30",
      "kind": "cram_school",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-10",
      "date": "2026-10-14",
      "title": "物理補講",
      "startTime": "18:30",
      "endTime": "19:30",
      "kind": "remedial_class",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-11",
      "date": "2026-10-15",
      "title": "塾・英数演習",
      "startTime": "19:00",
      "endTime": "21:30",
      "kind": "cram_school",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-12",
      "date": "2026-10-16",
      "title": "進路面談",
      "startTime": "16:30",
      "endTime": "17:30",
      "kind": "counseling",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-13",
      "date": "2026-10-17",
      "title": "共通テスト模試",
      "startTime": "09:00",
      "endTime": "12:30",
      "kind": "mock_exam",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-14",
      "date": "2026-10-17",
      "title": "模試振り返り会",
      "startTime": "13:30",
      "endTime": "14:30",
      "kind": "review_meeting",
      "source": "existing_plan",
      "hard": true
    },
    {
      "id": "exam-event-15",
      "date": "2026-10-18",
      "title": "家庭行事",
      "startTime": "13:00",
      "endTime": "15:00",
      "kind": "family",
      "source": "existing_plan",
      "hard": true
    }
  ],
  "workloads": [
    {
      "id": "math-calculus",
      "title": "数学・微積",
      "amount": 30,
      "unitCode": "problem",
      "minutesPerUnit": 6,
      "estimateMinutes": 180,
      "deadline": "2026-10-16",
      "splittable": true,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "english-reading",
      "title": "英語・長文",
      "amount": 4,
      "unitCode": "passage",
      "minutesPerUnit": 35,
      "estimateMinutes": 140,
      "deadline": "2026-10-18",
      "splittable": false,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "english-vocab",
      "title": "英単語",
      "amount": 140,
      "unitCode": "word",
      "minutesPerUnit": 1.2,
      "estimateMinutes": 168,
      "deadline": "2026-10-18",
      "splittable": true,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "physics",
      "title": "物理・力学",
      "amount": 20,
      "unitCode": "problem",
      "minutesPerUnit": 6,
      "estimateMinutes": 120,
      "deadline": "2026-10-18",
      "splittable": true,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "chemistry",
      "title": "化学・有機",
      "amount": 2,
      "unitCode": "chapter",
      "minutesPerUnit": 60,
      "estimateMinutes": 120,
      "deadline": "2026-10-18",
      "splittable": false,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "japanese-reading",
      "title": "現代文・記述",
      "amount": 3,
      "unitCode": "passage",
      "minutesPerUnit": 40,
      "estimateMinutes": 120,
      "deadline": "2026-10-18",
      "splittable": false,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "japanese-classics",
      "title": "古文・敬語",
      "amount": 1,
      "unitCode": "hour",
      "minutesPerUnit": 60,
      "estimateMinutes": 60,
      "deadline": "2026-10-18",
      "splittable": false,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "japanese-history",
      "title": "日本史・文化史",
      "amount": 1.5,
      "unitCode": "hour",
      "minutesPerUnit": 60,
      "estimateMinutes": 90,
      "deadline": "2026-10-18",
      "splittable": true,
      "preferredSessionCapMinutes": 60
    },
    {
      "id": "essay",
      "title": "小論文",
      "amount": 1,
      "unitCode": "essay",
      "minutesPerUnit": 90,
      "estimateMinutes": 90,
      "deadline": "2026-10-18",
      "splittable": false,
      "preferredSessionCapMinutes": 90
    }
  ],
  "prompts": [
    "来週の受験勉強をまとめて計画して。数学は微積の問題を30問（1問6分くらい）、英語は長文を4本（1本35分）と英単語を140個（25個で30分くらい）、物理の力学を20問（1問6分）、化学の有機を2章（1章60分）、現代文の記述を3題（1題40分）、古文の敬語を60分、日本史の文化史を90分、小論文を1本90分で進めたい。数学は金曜まで、それ以外は日曜まで。分けられる勉強は1回30〜60分にして、塾・部活・授業とか既存の予定を避けて、無理のないところへいい感じに分散して。",
    "数学は20問に減らして、英語長文は土日にまとめたい。ほかの科目はそのままで。",
    "水曜日に急な補講が17時30分から19時30分まで入った。かぶる予定だけ調整して。"
  ],
  "overloadVariant": {
    "additionalTarget": "物理をさらに120問（1問6分）増やす。来週中に全部やりたい。",
    "expectedBehavior": "明示的な実行不可能・未達・代替選択。黙った欠落や既存予定との重複は禁止"
  },
  "lifeBuffers": [
    {
      "date": "2026-10-12",
      "startTime": "19:00",
      "endTime": "19:30",
      "reason": "夕食",
      "hard": true
    },
    {
      "date": "2026-10-14",
      "startTime": "19:00",
      "endTime": "19:30",
      "reason": "夕食",
      "hard": true
    },
    {
      "date": "2026-10-16",
      "startTime": "19:00",
      "endTime": "19:30",
      "reason": "夕食",
      "hard": true
    },
    {
      "date": "2026-10-17",
      "startTime": "19:00",
      "endTime": "19:30",
      "reason": "夕食",
      "hard": true
    },
    {
      "date": "2026-10-18",
      "startTime": "19:00",
      "endTime": "19:30",
      "reason": "夕食",
      "hard": true
    },
    {
      "date": "2026-10-12",
      "startTime": "18:00",
      "endTime": "18:20",
      "reason": "部活後の帰宅",
      "hard": true
    },
    {
      "date": "2026-10-14",
      "startTime": "18:00",
      "endTime": "18:20",
      "reason": "部活後の帰宅",
      "hard": true
    },
    {
      "date": "2026-10-13",
      "startTime": "18:30",
      "endTime": "19:00",
      "reason": "塾への移動",
      "hard": true
    },
    {
      "date": "2026-10-13",
      "startTime": "21:30",
      "endTime": "21:50",
      "reason": "塾からの帰宅",
      "hard": true
    },
    {
      "date": "2026-10-15",
      "startTime": "18:30",
      "endTime": "19:00",
      "reason": "塾への移動",
      "hard": true
    },
    {
      "date": "2026-10-15",
      "startTime": "21:30",
      "endTime": "21:50",
      "reason": "塾からの帰宅",
      "hard": true
    },
    {
      "date": "2026-10-16",
      "startTime": "17:30",
      "endTime": "17:50",
      "reason": "面談後の帰宅",
      "hard": true
    },
    {
      "date": "2026-10-17",
      "startTime": "08:30",
      "endTime": "09:00",
      "reason": "模試会場へ移動",
      "hard": true
    },
    {
      "date": "2026-10-17",
      "startTime": "12:30",
      "endTime": "13:00",
      "reason": "模試後の移動",
      "hard": true
    }
  ]
};
