/* QD:CLINIC BEGIN v1.0.0 */
/*
 * Query Clinic: the practice database and the graded SQL course. Depends on QD:CORE.
 * The database is generated in the browser from a fixed seed, so it is identical on every device
 * and nothing has to be downloaded. Prairie Ridge College and everyone in it are fictional.
 *
 * Reference answers are not stored. Each check runs the reference SQL and the learner SQL on the
 * same database and compares the two result sets with QD.compareResults.
 */
(function (root) {
  'use strict';
  var QD = root.QD || (typeof require === 'function' ? require('./qd-core.js') : null);
  var C = {};
  C.VERSION = '1.0.0';
  C.PROJECT_NAME = 'Query Clinic';
  C.SEED = 20261123;

  /* ------------------------------------------------------------- generator */

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* Calendar arithmetic on whole days, with no Date object, so time zones cannot change the data. */
  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400), yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function civilFromDays(z) {
    z += 719468;
    var era = Math.floor(z / 146097), doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400, doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9);
    y += m <= 2 ? 1 : 0;
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  function iso(s) { var p = s.split('-'); return daysFromCivil(+p[0], +p[1], +p[2]); }

  var FIRST = ('Ada Ben Cora Dev Elena Finn Grace Hugo Iris Jonas Kira Leo Mara Nico Opal Pavel Quinn Rosa Sam Tess ' +
    'Uma Victor Wren Xavier Yara Zane Amir Bea Cruz Dina Ezra Faye Gus Hana Ivan June Kai Lena Milo Noor').split(' ');
  var LAST = ('Abbott Baird Calloway Dunmore Eastman Fairchild Garrity Holloway Ingram Jessup Kessler Lindqvist Marlowe ' +
    'Novak Okafor Pruitt Quarles Renner Sandoval Thackeray Underhill Vance Whitlock Yoder Zamora Ashby Brandt Corwin ' +
    'Delacroix Easton Farrow Goddard Hartwell Iverson Jarvis Kimball Larkin Mercer Nakamura Oakes Penhale Rourke ' +
    'Stroud Tolliver Upton Voss Wexler Yates Zeller Bellamy').split(' ');

  var DEPTS = [
    ['MATH', 'Mathematics'], ['ENGL', 'English'], ['BIOL', 'Biology'], ['HIST', 'History'],
    ['CSCI', 'Computer Science'], ['BUSN', 'Business'], ['PSYC', 'Psychology'], ['GEOL', 'Geology']
  ];
  /* dept index, number, title, credits, difficulty 0..1 (drives the grade spread). The last four are never offered. */
  var COURSES = [
    [0, 101, 'Intro to College Algebra', 3, 0.55], [0, 121, 'Calculus I', 4, 0.75], [0, 122, 'Calculus II', 4, 0.8],
    [0, 205, 'Elementary Statistics', 3, 0.5], [0, 240, 'Linear Algebra', 3, 0.6], [0, 310, 'A Second Introduction to Proofs', 3, 0.7],
    [1, 101, 'Composition I', 3, 0.3], [1, 102, 'Composition II', 3, 0.3], [1, 210, 'Intro to Literature', 3, 0.25],
    [1, 230, 'Technical Writing', 3, 0.3], [1, 315, 'American Novel', 3, 0.35], [1, 340, 'Creative Nonfiction', 3, 0.2],
    [2, 110, 'Introduction to Biology', 4, 0.5], [2, 111, 'Biology Lab', 1, 0.15], [2, 220, 'Microbiology', 4, 0.65],
    [2, 230, 'Human Anatomy', 4, 0.7], [2, 305, 'Genetics', 3, 0.7], [2, 330, 'Ecology', 3, 0.4],
    [3, 101, 'World Civilizations I', 3, 0.35], [3, 102, 'World Civilizations II', 3, 0.35], [3, 210, 'Kansas and the Plains', 3, 0.25],
    [3, 225, 'Intro to Public History', 3, 0.2], [3, 310, 'The Roman Republic', 3, 0.45], [3, 350, 'Research Seminar', 2, 0.3],
    [4, 105, 'Intro to Programming', 3, 0.55], [4, 150, 'Data and Spreadsheets', 2, 0.3], [4, 210, 'Data Structures', 4, 0.75],
    [4, 240, 'Databases and SQL', 3, 0.5], [4, 310, 'Algorithms', 3, 0.8], [4, 330, 'Web Development', 3, 0.4],
    [5, 101, 'Introduction to Business', 3, 0.25], [5, 210, 'Financial Accounting', 3, 0.6], [5, 220, 'Managerial Accounting', 3, 0.6],
    [5, 250, 'Principles of Marketing', 3, 0.3], [5, 310, 'Business Analytics', 3, 0.5], [5, 340, 'Operations Management', 3, 0.45],
    [6, 101, 'General Psychology', 3, 0.3], [6, 210, 'Lifespan Development', 3, 0.3], [6, 240, 'Research Methods', 4, 0.55],
    [6, 310, 'Cognitive Psychology', 3, 0.45], [7, 101, 'Physical Geology', 4, 0.45], [7, 235, 'Meteorology', 3, 0.3],
    [7, 335, 'Severe and Extreme Weather', 3, 0.3], [7, 102, 'Geology Lab', 1, 0.15],
    [0, 399, 'Special Topics in Mathematics', 3, 0.5], [4, 399, 'Special Topics in Computing', 3, 0.5],
    [5, 395, 'Internship in Business', 2, 0.2], [7, 390, 'Field Camp', 4, 0.4]
  ];
  var CAMPUSES = [['Main', 'Prairie Ridge', 1964], ['Riverbend', 'Riverbend', 1988], ['Northgate', 'Northgate', 2003], ['Cedar Hollow', 'Cedar Hollow', 2015]];
  var TERMS = [
    ['2025 Spring', '2025-01-13', '2025-05-09', 68], ['2025 Summer', '2025-06-02', '2025-07-25', 24], ['2025 Fall', '2025-08-18', '2025-12-12', 72],
    ['2026 Spring', '2026-01-12', '2026-05-08', 70], ['2026 Summer', '2026-06-01', '2026-07-24', 24], ['2026 Fall', '2026-08-17', '2026-12-11', 74]
  ];
  /* rooms per campus as [name, capacity]; capacities include the exact boundary values the exercises test */
  var ROOMS = [
    [['Hall 101', 60], ['Hall 102', 45], ['Hall 210', 40], ['Hall 215', 30], ['Lab A', 24], ['Lab B', 20], ['Seminar 1', 15], ['Seminar 2', 12]],
    [['River 100', 48], ['River 110', 36], ['River 120', 30], ['River 201', 28], ['River Lab', 20], ['River Seminar', 16]],
    [['North 1', 40], ['North 2', 35], ['North 3', 30], ['North 4', 22], ['North Lab', 18], ['North Seminar', 14]],
    [['Cedar 10', 32], ['Cedar 20', 26], ['Cedar Lab', 19], ['Cedar Seminar', 12]]
  ];
  var WO_CATS = ['Electrical', 'HVAC', 'Plumbing', 'Custodial', 'IT', 'Furniture'];
  var WO_PRI = ['Low', 'Normal', 'Normal', 'Normal', 'High', 'High', 'Urgent'];

  /**
   * Build the practice tables inside a project. opts.declareKeys (default true) adds PRIMARY KEY and
   * REFERENCES clauses. Pass false to get bare tables, which makes a good demonstration file for Key Finder.
   * Throws if any of the practice tables already exists.
   */
  C.seed = function (project, opts) {
    var o = opts || {}, declare = o.declareKeys !== false, r = rng(C.SEED), db = project.db;
    function ri(lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
    function pick(arr) { return arr[Math.floor(r() * arr.length)]; }
    function pk(col) { return col + ' INTEGER' + (declare ? ' PRIMARY KEY' : ''); }
    function fk(col, ref) { return col + ' INTEGER' + (declare ? ' REFERENCES ' + ref : ''); }
    C.TABLES.forEach(function (t) { if (project.hasTable(t)) throw new Error('The practice table ' + t + ' already exists in this project.'); });

    var ddl = [
      'CREATE TABLE campuses (' + pk('campus_id') + ', name TEXT, city TEXT, opened_year INTEGER)',
      'CREATE TABLE departments (' + pk('dept_id') + ', code TEXT, name TEXT)',
      'CREATE TABLE instructors (' + pk('instructor_id') + ', first_name TEXT, last_name TEXT, ' + fk('dept_id', 'departments(dept_id)') +
        ', hire_date TEXT, salary REAL, ' + fk('mentor_id', 'instructors(instructor_id)') + ')',
      'CREATE TABLE courses (' + pk('course_id') + ', ' + fk('dept_id', 'departments(dept_id)') + ', number INTEGER, title TEXT, credits INTEGER)',
      'CREATE TABLE terms (' + pk('term_id') + ', name TEXT, start_date TEXT, end_date TEXT)',
      'CREATE TABLE rooms (' + pk('room_id') + ', ' + fk('campus_id', 'campuses(campus_id)') + ', name TEXT, capacity INTEGER)',
      'CREATE TABLE sections (' + pk('section_id') + ', ' + fk('course_id', 'courses(course_id)') + ', ' + fk('term_id', 'terms(term_id)') + ', ' +
        fk('instructor_id', 'instructors(instructor_id)') + ', ' + fk('room_id', 'rooms(room_id)') + ', capacity INTEGER, modality TEXT)',
      'CREATE TABLE students (' + pk('student_id') + ', first_name TEXT, last_name TEXT, email TEXT, ' + fk('home_campus_id', 'campuses(campus_id)') + ', ' +
        fk('major_dept_id', 'departments(dept_id)') + ', enrolled_date TEXT, birth_date TEXT)',
      'CREATE TABLE enrollments (' + pk('enrollment_id') + ', ' + fk('student_id', 'students(student_id)') + ', ' + fk('section_id', 'sections(section_id)') +
        ', enrolled_on TEXT, status TEXT, grade TEXT, grade_points REAL)',
      'CREATE TABLE work_orders (' + pk('work_order_id') + ', ' + fk('campus_id', 'campuses(campus_id)') + ', ' + fk('room_id', 'rooms(room_id)') +
        ', category TEXT, priority TEXT, opened_on TEXT, closed_on TEXT, cost REAL)'
    ];
    function insertAll(table, rows) {
      if (!rows.length) return;
      var st = db.prepare('INSERT INTO ' + table + ' VALUES (' + rows[0].map(function () { return '?'; }).join(',') + ')');
      try { rows.forEach(function (row) { st.run(row); }); } finally { st.free(); }
    }

    var i, j, rows;
    db.run('BEGIN');
    try {
      ddl.forEach(function (d) { db.run(d); });

      insertAll('campuses', CAMPUSES.map(function (c, k) { return [k + 1, c[0], c[1], c[2]]; }));
      insertAll('departments', DEPTS.map(function (d, k) { return [k + 1, d[0], d[1]]; }));
      insertAll('terms', TERMS.map(function (t, k) { return [k + 1, t[0], t[1], t[2]]; }));

      var rooms = [], roomsByCampus = [[], [], [], []];
      ROOMS.forEach(function (list, c) {
        list.forEach(function (rm) { var id = rooms.length + 1; rooms.push([id, c + 1, rm[0], rm[1]]); roomsByCampus[c].push(id); });
      });
      insertAll('rooms', rooms);

      /* instructors: 36, four per department plus four new hires (33 to 36) who have not taught yet */
      var instructors = [], byDept = [[], [], [], [], [], [], [], []], usedNames = {};
      function personName() {
        var f, l, key;
        do { f = pick(FIRST); l = pick(LAST); key = f + ' ' + l; } while (usedNames[key]);
        usedNames[key] = true; return [f, l];
      }
      for (i = 1; i <= 36; i += 1) {
        var d = i <= 32 ? (i - 1) % 8 : [0, 4, 5, 7][i - 33];
        var nm = personName();
        var hire = i <= 32 ? civilFromDays(iso('2004-08-15') + ri(0, 7300)) : civilFromDays(iso('2026-08-01') + ri(0, 9));
        var salary = 52000 + ri(0, 380) * 100 + i * 7 + (i <= 32 ? Math.floor((iso('2026-01-01') - iso(hire)) / 365) * 900 : 0);
        var mentor = null;
        if (byDept[d].length && r() < 0.7) mentor = byDept[d][Math.floor(r() * byDept[d].length)];
        instructors.push([i, nm[0], nm[1], d + 1, hire, salary + 0.0, mentor]);
        byDept[d].push(i);
      }
      insertAll('instructors', instructors);
      var teaching = byDept.map(function (list) { return list.filter(function (id) { return id <= 32; }); });

      insertAll('courses', COURSES.map(function (c, k) { return [k + 1, c[0] + 1, c[1], c[2], c[3]]; }));
      var OFFERED = 44;

      /* students: 400. The last ten never enroll. */
      var students = [];
      for (i = 1; i <= 400; i += 1) {
        var f = pick(FIRST), l = pick(LAST);
        var campus = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4][ri(0, 9)];
        var major = r() < 0.12 ? null : ri(1, 8);
        students.push([i, f, l, (f + '.' + l + i + '@prairieridge.example').toLowerCase(), campus, major,
          civilFromDays(iso('2023-08-01') + ri(0, 1100)), civilFromDays(iso('1985-01-01') + ri(0, 8400))]);
      }
      insertAll('students', students);

      /* sections */
      var sections = [], sid = 0;
      TERMS.forEach(function (t, tk) {
        for (j = 0; j < t[3]; j += 1) {
          sid += 1;
          var ck = (j < OFFERED && t[3] > 40) ? j : ri(0, OFFERED - 1);
          var dept = COURSES[ck][0];
          var m = r(), modality = m < 0.24 ? 'Online' : (m < 0.36 ? 'Hybrid' : 'In person');
          var room = null, cap;
          if (modality === 'Online') cap = [30, 35, 40][ri(0, 2)];
          else {
            var cIdx = [0, 0, 0, 1, 1, 2, 2, 3][ri(0, 7)];
            room = pick(roomsByCampus[cIdx]);
            cap = rooms[room - 1][3];
            if (COURSES[ck][3] === 1) cap = Math.min(cap, 20);
          }
          var inst = pick(teaching[dept]);
          if (tk === 5 && r() < 0.08) inst = null;
          sections.push([sid, ck + 1, tk + 1, inst, room, cap, modality]);
        }
      });
      insertAll('sections', sections);

      /* enrollments */
      var enrollments = [], eid = 0, LETTERS = ['A', 'B', 'C', 'D', 'F'];
      sections.forEach(function (s) {
        var cap = s[5], tk = s[2] - 1, diff = COURSES[s[1] - 1][4];
        var n = Math.max(3, Math.round(cap * (0.45 + r() * 0.7)));
        var chosen = {}, count = 0, start = iso(TERMS[tk][1]);
        while (count < n) {
          var st = ri(1, 390);
          if (chosen[st]) continue;
          chosen[st] = true; count += 1; eid += 1;
          var withdrawn = r() < 0.05 + diff * 0.09;
          var status = withdrawn ? 'Withdrawn' : (tk === 5 ? 'Enrolled' : 'Completed');
          var grade = null, pts = null;
          if (status === 'Completed') {
            var x = r() + (diff - 0.45) * 0.55, gi = x < 0.30 ? 0 : (x < 0.62 ? 1 : (x < 0.82 ? 2 : (x < 0.92 ? 3 : 4)));
            grade = LETTERS[gi]; pts = 4 - gi + 0.0;
          }
          enrollments.push([eid, st, s[0], civilFromDays(start - ri(5, 60)), status, grade, pts]);
        }
      });
      insertAll('enrollments', enrollments);

      /* work orders: 240. Cedar Hollow (campus 4) has none open. */
      var orders = [], base = iso('2025-01-06'), span = iso('2026-11-10') - base;
      for (i = 1; i <= 240; i += 1) {
        var wc = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3][ri(0, 9)];
        var wroom = r() < 0.3 ? null : pick(roomsByCampus[wc]);
        var opened = base + ri(0, span);
        var isOpen = wc !== 3 && r() < 0.16;
        var closed = isOpen ? null : civilFromDays(opened + ri(0, 30));
        var cost = (isOpen || r() < 0.1) ? null : ri(2500, 240000) / 100;
        orders.push([i, wc + 1, wroom, pick(WO_CATS), pick(WO_PRI), civilFromDays(opened), closed, cost]);
      }
      insertAll('work_orders', orders);
      db.run('COMMIT');
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (e2) { /* ignore */ }
      throw e;
    }
    project.setMeta('clinic_seed', String(C.SEED));
    project.setMeta('clinic_version', C.VERSION);
    project._touch('schema');
    return C.TABLES.slice();
  };
  C.TABLES = ['campuses', 'departments', 'instructors', 'courses', 'terms', 'rooms', 'sections', 'students', 'enrollments', 'work_orders'];

  /** Create a ready to use Query Clinic project. */
  C.createProject = function () {
    var p = QD.create(C.PROJECT_NAME);
    C.seed(p);
    return p;
  };

  /* -------------------------------------------------------------- the course */

  C.UNITS = [
    { id: 1, title: 'Select and filter', blurb: 'Choose columns with SELECT and rows with WHERE.' },
    { id: 2, title: 'Sort and limit', blurb: 'Put rows in order and keep only the first few.' },
    { id: 3, title: 'Empty values and expressions', blurb: 'NULL, COALESCE, CASE and building new columns.' },
    { id: 4, title: 'Summaries', blurb: 'COUNT, SUM, AVG, MIN and MAX over a whole table.' },
    { id: 5, title: 'Group by', blurb: 'One summary row per group, and HAVING to filter groups.' },
    { id: 6, title: 'Joins', blurb: 'Combine tables through their keys.' },
    { id: 7, title: 'Outer joins', blurb: 'Keep rows that have no match, and find what is missing.' },
    { id: 8, title: 'Subqueries and CTEs', blurb: 'Use one query inside another.' },
    { id: 9, title: 'Window functions', blurb: 'Rank, running totals and comparisons across rows.' },
    { id: 10, title: 'Capstone', blurb: 'Two real reporting questions that combine everything.' }
  ];

  /*
   * Each exercise:
   *   id, unit, title, prompt, ordered (row order is graded), solution,
   *   alt (a second correct answer, used by the tests to prove the checker accepts other routes),
   *   wrong (a common mistake, used by the tests to prove the checker rejects it),
   *   hint, concept, tsql (how SQL Server differs, when it does)
   */
  C.EXERCISES = [
    { id: '1.1', unit: 1, title: 'Everything in a table', ordered: false,
      prompt: 'Show every column of every campus.',
      solution: 'SELECT * FROM campuses',
      alt: 'SELECT campus_id, name, city, opened_year FROM campuses',
      wrong: 'SELECT name, city FROM campuses',
      hint: 'The star means every column.',
      concept: 'SELECT chooses columns and FROM names the table. SELECT * returns every column in table order.' },
    { id: '1.2', unit: 1, title: 'Chosen columns', ordered: false,
      prompt: 'List the first name, last name and email of every student, with the columns in that order.',
      solution: 'SELECT first_name, last_name, email FROM students',
      alt: 'SELECT s.first_name AS first, s.last_name AS last, s.email FROM students AS s',
      wrong: 'SELECT last_name, first_name, email FROM students',
      hint: 'List the column names after SELECT, separated by commas, in the order asked for.',
      concept: 'Columns come back in the order you list them. Names given with AS are labels only.' },
    { id: '1.3', unit: 1, title: 'Filter on a number', ordered: false,
      prompt: 'Which courses are worth 4 credits? Show the title and the credits.',
      solution: 'SELECT title, credits FROM courses WHERE credits = 4',
      alt: 'SELECT title, credits FROM courses WHERE credits > 3',
      wrong: 'SELECT title, credits FROM courses WHERE credits >= 3',
      hint: 'WHERE comes after FROM and keeps only rows where the test is true.',
      concept: 'WHERE filters rows before anything else happens to them.' },
    { id: '1.4', unit: 1, title: 'Two conditions', ordered: false,
      prompt: 'Find the rooms at campus 2 that seat at least 30. Show the room name and capacity.',
      solution: 'SELECT name, capacity FROM rooms WHERE campus_id = 2 AND capacity >= 30',
      alt: 'SELECT name, capacity FROM rooms WHERE capacity > 29 AND campus_id IN (2)',
      wrong: 'SELECT name, capacity FROM rooms WHERE campus_id = 2 AND capacity > 30',
      hint: 'Join two tests with AND. At least 30 includes 30 itself.',
      concept: 'AND requires both tests. Watch the boundary: at least means >=, more than means >.' },
    { id: '1.5', unit: 1, title: 'Match the start of text', ordered: false,
      prompt: 'Show the number and title of every course whose title starts with Intro.',
      solution: "SELECT number, title FROM courses WHERE title LIKE 'Intro%'",
      alt: "SELECT number, title FROM courses WHERE substr(title, 1, 5) = 'Intro'",
      wrong: "SELECT number, title FROM courses WHERE title LIKE '%Intro%'",
      hint: 'In LIKE, the percent sign stands for any run of characters. Put it only where anything may follow.',
      concept: 'LIKE matches patterns. Text values go in single quotes.',
      tsql: 'SQL Server uses LEFT(title, 5) or SUBSTRING(title, 1, 5) instead of substr. Whether LIKE ignores case depends on the collation there; in SQLite it ignores case for plain letters.' },

    { id: '2.1', unit: 2, title: 'Top five', ordered: true,
      prompt: 'Show the five highest paid instructors: last name and salary, highest salary first.',
      solution: 'SELECT last_name, salary FROM instructors ORDER BY salary DESC LIMIT 5',
      alt: 'SELECT last_name, salary FROM (SELECT last_name, salary, row_number() OVER (ORDER BY salary DESC) AS rn FROM instructors) WHERE rn <= 5 ORDER BY rn',
      wrong: 'SELECT last_name, salary FROM instructors ORDER BY salary LIMIT 5',
      hint: 'ORDER BY sorts, DESC reverses, and LIMIT keeps the first rows.',
      concept: 'ORDER BY runs near the end, and LIMIT cuts the sorted list.',
      tsql: 'SQL Server has no LIMIT. Write SELECT TOP 5 last_name, salary FROM instructors ORDER BY salary DESC, or use OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY after ORDER BY.' },
    { id: '2.2', unit: 2, title: 'Each value once', ordered: true,
      prompt: 'List each section modality once, in alphabetical order.',
      solution: 'SELECT DISTINCT modality FROM sections ORDER BY modality',
      alt: 'SELECT modality FROM sections GROUP BY modality ORDER BY 1',
      wrong: 'SELECT modality FROM sections ORDER BY modality',
      hint: 'DISTINCT goes right after SELECT.',
      concept: 'DISTINCT removes duplicate rows from the result.' },
    { id: '2.3', unit: 2, title: 'Sort on several columns', ordered: true,
      prompt: 'Sort students by last name, then first name, then student_id, and show the first ten: last_name, first_name, student_id.',
      solution: 'SELECT last_name, first_name, student_id FROM students ORDER BY last_name, first_name, student_id LIMIT 10',
      alt: 'SELECT last_name, first_name, student_id FROM students ORDER BY 1, 2, 3 LIMIT 10',
      wrong: 'SELECT last_name, first_name, student_id FROM students ORDER BY first_name, last_name, student_id LIMIT 10',
      hint: 'List the sort columns in order of importance.',
      concept: 'Later sort columns only break ties left by earlier ones. A final unique column makes the order fully repeatable.' },

    { id: '3.1', unit: 3, title: 'Find the empty ones', ordered: false,
      prompt: 'Which sections have no instructor assigned? Show section_id and term_id.',
      solution: 'SELECT section_id, term_id FROM sections WHERE instructor_id IS NULL',
      alt: 'SELECT section_id, term_id FROM sections WHERE coalesce(instructor_id, -1) = -1',
      wrong: 'SELECT section_id, term_id FROM sections WHERE instructor_id = NULL',
      hint: 'NULL is never equal to anything, not even NULL. Use IS NULL.',
      concept: 'NULL means unknown. Comparisons with NULL are neither true nor false, so = NULL matches nothing.' },
    { id: '3.2', unit: 3, title: 'Replace an empty value', ordered: false,
      prompt: 'List every work order with its cost, showing 0 when the cost is missing: work_order_id and the cost.',
      solution: 'SELECT work_order_id, coalesce(cost, 0) FROM work_orders',
      alt: 'SELECT work_order_id, CASE WHEN cost IS NULL THEN 0 ELSE cost END FROM work_orders',
      wrong: 'SELECT work_order_id, cost FROM work_orders',
      hint: 'COALESCE returns its first argument that is not NULL.',
      concept: 'COALESCE supplies a stand in for NULL.',
      tsql: 'COALESCE works the same in SQL Server. ISNULL(cost, 0) is the older SQL Server only form.' },
    { id: '3.3', unit: 3, title: 'Label by range', ordered: false,
      prompt: 'Show each room name with a size label: Small for under 20 seats, Medium for 20 to 39, and Large for 40 or more.',
      solution: "SELECT name, CASE WHEN capacity < 20 THEN 'Small' WHEN capacity < 40 THEN 'Medium' ELSE 'Large' END FROM rooms",
      alt: "SELECT name, CASE WHEN capacity >= 40 THEN 'Large' WHEN capacity >= 20 THEN 'Medium' ELSE 'Small' END AS size FROM rooms",
      wrong: "SELECT name, CASE WHEN capacity <= 20 THEN 'Small' WHEN capacity <= 40 THEN 'Medium' ELSE 'Large' END FROM rooms",
      hint: 'CASE checks its WHEN tests from the top and stops at the first true one.',
      concept: 'CASE builds a new column from conditions. Order matters because the first match wins.' },
    { id: '3.4', unit: 3, title: 'Build text and pull a year', ordered: false,
      prompt: 'For each instructor show the full name as one column (first name, a space, last name) and the year they were hired.',
      solution: "SELECT first_name || ' ' || last_name, strftime('%Y', hire_date) FROM instructors",
      alt: "SELECT printf('%s %s', first_name, last_name) AS full_name, CAST(substr(hire_date, 1, 4) AS INTEGER) AS hire_year FROM instructors",
      wrong: "SELECT last_name || ' ' || first_name, strftime('%Y', hire_date) FROM instructors",
      hint: 'Two vertical bars glue text together. strftime pulls parts out of a date.',
      concept: 'Expressions make new columns from existing ones.',
      tsql: "SQL Server joins text with + or CONCAT(first_name, ' ', last_name), and gets the year with YEAR(hire_date)." },

    { id: '4.1', unit: 4, title: 'Count rows', ordered: false,
      prompt: 'How many students are there?',
      solution: 'SELECT count(*) FROM students',
      alt: 'SELECT count(student_id) AS n FROM students',
      wrong: 'SELECT count(major_dept_id) FROM students',
      hint: 'count(*) counts rows.',
      concept: 'An aggregate turns many rows into one value.' },
    { id: '4.2', unit: 4, title: 'Lowest, highest, average', ordered: false,
      prompt: 'Show the lowest, the highest and the average instructor salary, in that order, with the average rounded to 2 places.',
      solution: 'SELECT min(salary), max(salary), round(avg(salary), 2) FROM instructors',
      alt: 'SELECT min(salary), max(salary), round(sum(salary) / count(*), 2) FROM instructors',
      wrong: 'SELECT max(salary), min(salary), round(avg(salary), 2) FROM instructors',
      hint: 'Several aggregates can sit side by side in one SELECT.',
      concept: 'MIN, MAX and AVG each scan the whole table and return one value.' },
    { id: '4.3', unit: 4, title: 'Count rows and count values', ordered: false,
      prompt: 'In one row show two numbers: how many enrollments exist, and how many of them have a grade.',
      solution: 'SELECT count(*), count(grade) FROM enrollments',
      alt: 'SELECT count(*), sum(grade IS NOT NULL) FROM enrollments',
      wrong: 'SELECT count(*), count(*) FROM enrollments',
      hint: 'count(column) skips rows where that column is NULL.',
      concept: 'count(*) counts rows. count(column) counts the rows where the column has a value.',
      tsql: 'SQL Server cannot sum a true or false test directly. Write SUM(CASE WHEN grade IS NOT NULL THEN 1 ELSE 0 END) or simply COUNT(grade).' },
    { id: '4.4', unit: 4, title: 'Count different values', ordered: false,
      prompt: 'How many different students have at least one enrollment?',
      solution: 'SELECT count(DISTINCT student_id) FROM enrollments',
      alt: 'SELECT count(*) FROM (SELECT student_id FROM enrollments GROUP BY student_id)',
      wrong: 'SELECT count(student_id) FROM enrollments',
      hint: 'Put DISTINCT inside the count.',
      concept: 'count(DISTINCT x) counts each different value once.' },

    { id: '5.1', unit: 5, title: 'Count per group', ordered: false,
      prompt: 'How many students call each campus home? Show home_campus_id and the number of students.',
      solution: 'SELECT home_campus_id, count(*) FROM students GROUP BY home_campus_id',
      alt: 'SELECT c.campus_id, (SELECT count(*) FROM students s WHERE s.home_campus_id = c.campus_id) FROM campuses c',
      wrong: 'SELECT home_campus_id, count(major_dept_id) FROM students GROUP BY home_campus_id',
      hint: 'GROUP BY makes one row per value of the grouping column.',
      concept: 'GROUP BY splits the rows into groups, and each aggregate is worked out per group.' },
    { id: '5.2', unit: 5, title: 'Count per status', ordered: false,
      prompt: 'How many enrollments are there for each status? Show the status and the count.',
      solution: 'SELECT status, count(*) FROM enrollments GROUP BY status',
      alt: 'SELECT status, sum(1) AS n FROM enrollments GROUP BY 1',
      wrong: 'SELECT status, count(grade) FROM enrollments GROUP BY status',
      hint: 'Group on status.',
      concept: 'Every column in SELECT is either grouped on or inside an aggregate.' },
    { id: '5.3', unit: 5, title: 'Filter the groups', ordered: false,
      prompt: 'For each section with at least 10 graded enrollments, show section_id and the average grade_points rounded to 2 places.',
      solution: 'SELECT section_id, round(avg(grade_points), 2) FROM enrollments WHERE grade_points IS NOT NULL GROUP BY section_id HAVING count(*) >= 10',
      alt: 'SELECT section_id, round(avg(grade_points), 2) FROM enrollments GROUP BY section_id HAVING count(grade_points) >= 10',
      wrong: 'SELECT section_id, round(avg(grade_points), 2) FROM enrollments GROUP BY section_id HAVING count(*) >= 10',
      hint: 'WHERE filters rows before grouping. HAVING filters groups after.',
      concept: 'HAVING is WHERE for groups. Be clear about what is being counted: rows, or rows with a value.' },
    { id: '5.4', unit: 5, title: 'Totals per category', ordered: true,
      prompt: 'For closed work orders that have a cost, show each category with its total cost and average cost, both rounded to 2 places, biggest total first.',
      solution: 'SELECT category, round(sum(cost), 2), round(avg(cost), 2) FROM work_orders WHERE closed_on IS NOT NULL AND cost IS NOT NULL GROUP BY category ORDER BY sum(cost) DESC',
      alt: 'SELECT category, round(sum(cost), 2) AS total, round(sum(cost) / count(cost), 2) AS average FROM work_orders WHERE cost IS NOT NULL AND closed_on IS NOT NULL GROUP BY category ORDER BY 2 DESC',
      wrong: 'SELECT category, round(sum(cost), 2), round(avg(coalesce(cost, 0)), 2) FROM work_orders WHERE closed_on IS NOT NULL GROUP BY category ORDER BY sum(cost) DESC',
      hint: 'Filter first, then group, then sort on the total.',
      concept: 'AVG ignores NULL. Turning NULL into 0 first changes the average, because the zeros are then counted.' },
    { id: '5.5', unit: 5, title: 'Group by a piece of a date', ordered: true,
      prompt: 'How many work orders were opened in each month? Show the month as YYYY-MM and the count, earliest month first.',
      solution: "SELECT strftime('%Y-%m', opened_on), count(*) FROM work_orders GROUP BY 1 ORDER BY 1",
      alt: 'SELECT substr(opened_on, 1, 7) AS month, count(*) FROM work_orders GROUP BY month ORDER BY month',
      wrong: "SELECT strftime('%m', opened_on), count(*) FROM work_orders GROUP BY 1 ORDER BY 1",
      hint: 'You can group on an expression. Keep the year in it, or January of two years will merge.',
      concept: 'Any expression can be a grouping key.',
      tsql: "SQL Server writes this as FORMAT(opened_on, 'yyyy-MM'), or groups on YEAR(opened_on), MONTH(opened_on). It also does not allow GROUP BY 1: repeat the expression instead." },

    { id: '6.1', unit: 6, title: 'Two tables', ordered: false,
      prompt: 'For sections offered in term 6, show section_id and the course title.',
      solution: 'SELECT s.section_id, c.title FROM sections s JOIN courses c ON c.course_id = s.course_id WHERE s.term_id = 6',
      alt: 'SELECT section_id, (SELECT title FROM courses c WHERE c.course_id = s.course_id) FROM sections s WHERE term_id = 6',
      wrong: 'SELECT s.section_id, c.title FROM sections s JOIN courses c ON c.course_id = s.course_id',
      hint: 'JOIN the two tables ON the column they share, then filter.',
      concept: 'A join pairs each row with its match in another table through a key.' },
    { id: '6.2', unit: 6, title: 'Four tables', ordered: false,
      prompt: 'Show everything student 17 has enrolled in: the course title, the term name and the grade.',
      solution: 'SELECT c.title, t.name, e.grade FROM enrollments e JOIN sections s ON s.section_id = e.section_id JOIN courses c ON c.course_id = s.course_id JOIN terms t ON t.term_id = s.term_id WHERE e.student_id = 17',
      alt: 'SELECT c.title, t.name, e.grade FROM terms t JOIN sections s USING (term_id) JOIN courses c USING (course_id) JOIN enrollments e USING (section_id) WHERE e.student_id = 17',
      wrong: 'SELECT c.title, t.name, e.grade FROM enrollments e JOIN sections s ON s.section_id = e.section_id JOIN courses c ON c.course_id = s.course_id JOIN terms t ON t.term_id = s.term_id WHERE e.student_id = 17 AND e.grade IS NOT NULL',
      hint: 'Walk the keys: enrollments to sections, then sections to courses and to terms.',
      concept: 'Joins chain. Each new table needs its own ON condition.',
      tsql: 'SQL Server does not support JOIN ... USING. Write the ON condition out.' },
    { id: '6.3', unit: 6, title: 'Join, then group', ordered: false,
      prompt: 'How many sections has each department offered across all terms? Show the department name and the count.',
      solution: 'SELECT d.name, count(*) FROM departments d JOIN courses c ON c.dept_id = d.dept_id JOIN sections s ON s.course_id = c.course_id GROUP BY d.dept_id, d.name',
      alt: 'SELECT d.name, (SELECT count(*) FROM sections s WHERE s.course_id IN (SELECT course_id FROM courses c WHERE c.dept_id = d.dept_id)) FROM departments d',
      wrong: 'SELECT d.name, count(*) FROM departments d JOIN courses c ON c.dept_id = d.dept_id GROUP BY d.dept_id, d.name',
      hint: 'Sections reach departments through courses.',
      concept: 'Join first to bring the label and the rows together, then group on the label.' },
    { id: '6.4', unit: 6, title: 'Each match once', ordered: false,
      prompt: 'Which instructors teach at least one Online section in term 6? Show last_name and first_name, with each instructor listed once.',
      solution: "SELECT DISTINCT i.last_name, i.first_name FROM instructors i JOIN sections s ON s.instructor_id = i.instructor_id WHERE s.term_id = 6 AND s.modality = 'Online'",
      alt: "SELECT last_name, first_name FROM instructors i WHERE EXISTS (SELECT 1 FROM sections s WHERE s.instructor_id = i.instructor_id AND s.term_id = 6 AND s.modality = 'Online')",
      wrong: "SELECT i.last_name, i.first_name FROM instructors i JOIN sections s ON s.instructor_id = i.instructor_id WHERE s.term_id = 6 AND s.modality = 'Online'",
      hint: 'A join returns one row per match, so an instructor with two such sections appears twice unless you remove duplicates.',
      concept: 'Joins multiply rows. DISTINCT or EXISTS answers which ones, rather than how many matches.' },
    { id: '6.5', unit: 6, title: 'A table joined to itself', ordered: false,
      prompt: "For each instructor who has a mentor, show the instructor's last name and then the mentor's last name.",
      solution: 'SELECT i.last_name, m.last_name FROM instructors i JOIN instructors m ON m.instructor_id = i.mentor_id',
      alt: 'SELECT i.last_name, (SELECT m.last_name FROM instructors m WHERE m.instructor_id = i.mentor_id) FROM instructors i WHERE i.mentor_id IS NOT NULL',
      wrong: 'SELECT i.last_name, m.last_name FROM instructors i LEFT JOIN instructors m ON m.instructor_id = i.mentor_id',
      hint: 'Use the same table twice with two different aliases.',
      concept: 'A self join treats one table as two, which is how a row points at another row of its own kind.' },

    { id: '7.1', unit: 7, title: 'Keep the unmatched', ordered: false,
      prompt: 'Show every instructor with the number of sections they have ever taught, including instructors who have taught none: instructor_id and the count.',
      solution: 'SELECT i.instructor_id, count(s.section_id) FROM instructors i LEFT JOIN sections s ON s.instructor_id = i.instructor_id GROUP BY i.instructor_id',
      alt: 'SELECT instructor_id, (SELECT count(*) FROM sections s WHERE s.instructor_id = i.instructor_id) FROM instructors i',
      wrong: 'SELECT i.instructor_id, count(*) FROM instructors i LEFT JOIN sections s ON s.instructor_id = i.instructor_id GROUP BY i.instructor_id',
      hint: 'LEFT JOIN keeps every row of the left table. Count a column from the right table so the empty matches count as zero.',
      concept: 'An outer join keeps rows with no match and fills the other side with NULL. count(*) would count that filler row as one.' },
    { id: '7.2', unit: 7, title: 'Find what is missing', ordered: false,
      prompt: 'Which courses have never been offered as a section? Show the title.',
      solution: 'SELECT c.title FROM courses c LEFT JOIN sections s ON s.course_id = c.course_id WHERE s.section_id IS NULL',
      alt: 'SELECT title FROM courses c WHERE NOT EXISTS (SELECT 1 FROM sections s WHERE s.course_id = c.course_id)',
      wrong: 'SELECT c.title FROM courses c JOIN sections s ON s.course_id = c.course_id WHERE s.section_id IS NULL',
      hint: 'LEFT JOIN, then keep only the rows where the right side came back empty.',
      concept: 'This shape is called an anti join. NOT EXISTS says the same thing directly.' },
    { id: '7.3', unit: 7, title: 'Fill in a missing match', ordered: false,
      prompt: 'For term 6 sections show section_id and the room name, showing the word Online when the section has no room.',
      solution: "SELECT s.section_id, coalesce(r.name, 'Online') FROM sections s LEFT JOIN rooms r ON r.room_id = s.room_id WHERE s.term_id = 6",
      alt: "SELECT s.section_id, CASE WHEN s.room_id IS NULL THEN 'Online' ELSE (SELECT name FROM rooms r WHERE r.room_id = s.room_id) END FROM sections s WHERE s.term_id = 6",
      wrong: "SELECT s.section_id, coalesce(r.name, 'Online') FROM sections s JOIN rooms r ON r.room_id = s.room_id WHERE s.term_id = 6",
      hint: 'An inner join would drop the sections with no room.',
      concept: 'LEFT JOIN plus COALESCE keeps the row and labels the gap.' },
    { id: '7.4', unit: 7, title: 'A condition in the right place', ordered: false,
      prompt: 'Show every campus name with its number of open work orders (closed_on is empty), including campuses that have none open.',
      solution: 'SELECT c.name, count(w.work_order_id) FROM campuses c LEFT JOIN work_orders w ON w.campus_id = c.campus_id AND w.closed_on IS NULL GROUP BY c.campus_id, c.name',
      alt: 'SELECT name, (SELECT count(*) FROM work_orders w WHERE w.campus_id = c.campus_id AND w.closed_on IS NULL) FROM campuses c',
      wrong: 'SELECT c.name, count(w.work_order_id) FROM campuses c LEFT JOIN work_orders w ON w.campus_id = c.campus_id WHERE w.closed_on IS NULL GROUP BY c.campus_id, c.name',
      hint: 'A test on the right hand table belongs in ON. In WHERE it throws away the campuses you meant to keep.',
      concept: 'With a LEFT JOIN, ON decides what matches and WHERE decides what survives. Filtering the right table in WHERE turns the join back into an inner join.' },

    { id: '8.1', unit: 8, title: 'Compare with a single value', ordered: false,
      prompt: 'Which instructors are paid more than the average instructor salary? Show last_name and salary.',
      solution: 'SELECT last_name, salary FROM instructors WHERE salary > (SELECT avg(salary) FROM instructors)',
      alt: 'WITH a AS (SELECT avg(salary) AS avg_salary FROM instructors) SELECT i.last_name, i.salary FROM instructors i CROSS JOIN a WHERE i.salary > a.avg_salary',
      wrong: 'SELECT last_name, salary FROM instructors i WHERE salary > (SELECT avg(salary) FROM instructors d WHERE d.dept_id = i.dept_id)',
      hint: 'A query in parentheses that returns one value can be used like a number.',
      concept: 'A scalar subquery returns one value. An aggregate cannot go straight into WHERE, but a subquery can.' },
    { id: '8.2', unit: 8, title: 'Membership in a list', ordered: false,
      prompt: 'Which students have enrolled in at least one course from the department with code MATH? Show student_id, with each student once.',
      solution: "SELECT DISTINCT e.student_id FROM enrollments e WHERE e.section_id IN (SELECT s.section_id FROM sections s JOIN courses c ON c.course_id = s.course_id JOIN departments d ON d.dept_id = c.dept_id WHERE d.code = 'MATH')",
      alt: "SELECT e.student_id FROM enrollments e JOIN sections s ON s.section_id = e.section_id JOIN courses c ON c.course_id = s.course_id JOIN departments d ON d.dept_id = c.dept_id WHERE d.code = 'MATH' GROUP BY e.student_id",
      wrong: "SELECT e.student_id FROM enrollments e JOIN sections s ON s.section_id = e.section_id JOIN courses c ON c.course_id = s.course_id JOIN departments d ON d.dept_id = c.dept_id WHERE d.code = 'MATH'",
      hint: 'Build the list of MATH sections first, then ask which enrollments are IN it.',
      concept: 'IN tests membership in the result of another query.' },
    { id: '8.3', unit: 8, title: 'Name a step with a CTE', ordered: false,
      prompt: 'Count the enrollments in each section that are not Withdrawn, then list the sections where that count is greater than the capacity: section_id, capacity and the count.',
      solution: "WITH filled AS (SELECT section_id, count(*) AS n FROM enrollments WHERE status <> 'Withdrawn' GROUP BY section_id) SELECT s.section_id, s.capacity, f.n FROM sections s JOIN filled f ON f.section_id = s.section_id WHERE f.n > s.capacity",
      alt: "SELECT s.section_id, s.capacity, count(*) FROM sections s JOIN enrollments e ON e.section_id = s.section_id WHERE e.status IN ('Enrolled', 'Completed') GROUP BY s.section_id, s.capacity HAVING count(*) > s.capacity",
      wrong: 'WITH filled AS (SELECT section_id, count(*) AS n FROM enrollments GROUP BY section_id) SELECT s.section_id, s.capacity, f.n FROM sections s JOIN filled f ON f.section_id = s.section_id WHERE f.n > s.capacity',
      hint: 'WITH name AS (query) gives a query a name you can join to like a table.',
      concept: 'A CTE breaks a problem into named steps that read top to bottom.' },
    { id: '8.4', unit: 8, title: 'The top row in each group', ordered: false,
      prompt: 'Who is the highest paid instructor in each department? Show the department code, last_name and salary.',
      solution: 'SELECT d.code, i.last_name, i.salary FROM instructors i JOIN departments d ON d.dept_id = i.dept_id WHERE i.salary = (SELECT max(x.salary) FROM instructors x WHERE x.dept_id = i.dept_id)',
      alt: 'SELECT code, last_name, salary FROM (SELECT d.code, i.last_name, i.salary, row_number() OVER (PARTITION BY i.dept_id ORDER BY i.salary DESC) AS rn FROM instructors i JOIN departments d ON d.dept_id = i.dept_id) WHERE rn = 1',
      wrong: 'SELECT d.code, i.last_name, i.salary FROM instructors i JOIN departments d ON d.dept_id = i.dept_id WHERE i.salary = (SELECT min(x.salary) FROM instructors x WHERE x.dept_id = i.dept_id)',
      hint: 'A subquery can refer to the row outside it. Ask for the top salary in this row\'s department.',
      concept: 'A correlated subquery runs once per outer row. Grouping alone cannot return the name that goes with the maximum.' },

    { id: '9.1', unit: 9, title: 'Rank inside groups', ordered: false,
      prompt: 'Rank instructors by salary inside each department, highest first. Show dept_id, last_name, salary and the rank.',
      solution: 'SELECT dept_id, last_name, salary, rank() OVER (PARTITION BY dept_id ORDER BY salary DESC) FROM instructors',
      alt: 'SELECT i.dept_id, i.last_name, i.salary, 1 + (SELECT count(*) FROM instructors x WHERE x.dept_id = i.dept_id AND x.salary > i.salary) FROM instructors i',
      wrong: 'SELECT dept_id, last_name, salary, rank() OVER (ORDER BY salary DESC) FROM instructors',
      hint: 'OVER (PARTITION BY ... ORDER BY ...) restarts the ranking for each department.',
      concept: 'A window function adds a value to each row without collapsing rows the way GROUP BY does.' },
    { id: '9.2', unit: 9, title: 'Running total', ordered: true,
      prompt: 'For campus 1, take the work orders that have a cost, in order of opened_on and then work_order_id. Show work_order_id, cost and the running total of cost.',
      solution: 'SELECT work_order_id, cost, sum(cost) OVER (ORDER BY opened_on, work_order_id) FROM work_orders WHERE campus_id = 1 AND cost IS NOT NULL ORDER BY opened_on, work_order_id',
      alt: 'SELECT w.work_order_id, w.cost, (SELECT sum(x.cost) FROM work_orders x WHERE x.campus_id = 1 AND x.cost IS NOT NULL AND (x.opened_on < w.opened_on OR (x.opened_on = w.opened_on AND x.work_order_id <= w.work_order_id))) FROM work_orders w WHERE w.campus_id = 1 AND w.cost IS NOT NULL ORDER BY w.opened_on, w.work_order_id',
      wrong: 'SELECT work_order_id, cost, sum(cost) OVER () FROM work_orders WHERE campus_id = 1 AND cost IS NOT NULL ORDER BY opened_on, work_order_id',
      hint: 'SUM with an ORDER BY inside OVER adds up everything so far.',
      concept: 'An ordered window makes aggregates cumulative. Include a unique column in the window order so ties cannot be added together.' },
    { id: '9.3', unit: 9, title: 'Top three per group', ordered: false,
      prompt: 'A student GPA is the average grade_points over their graded enrollments. Among students with at least 8 graded enrollments, show the top 3 by GPA at each home campus, breaking ties by lower student_id: home_campus_id, student_id and the GPA rounded to 2 places.',
      solution: 'WITH g AS (SELECT s.home_campus_id, s.student_id, avg(e.grade_points) AS gpa FROM students s JOIN enrollments e ON e.student_id = s.student_id WHERE e.grade_points IS NOT NULL GROUP BY s.student_id, s.home_campus_id HAVING count(*) >= 8), r AS (SELECT g.*, row_number() OVER (PARTITION BY home_campus_id ORDER BY gpa DESC, student_id) AS rn FROM g) SELECT home_campus_id, student_id, round(gpa, 2) FROM r WHERE rn <= 3',
      alt: 'WITH g AS (SELECT s.home_campus_id, s.student_id, avg(e.grade_points) AS gpa FROM students s JOIN enrollments e ON e.student_id = s.student_id GROUP BY s.student_id, s.home_campus_id HAVING count(e.grade_points) >= 8) SELECT a.home_campus_id, a.student_id, round(a.gpa, 2) FROM g a WHERE (SELECT count(*) FROM g b WHERE b.home_campus_id = a.home_campus_id AND (b.gpa > a.gpa OR (b.gpa = a.gpa AND b.student_id < a.student_id))) < 3',
      wrong: 'WITH g AS (SELECT s.home_campus_id, s.student_id, avg(e.grade_points) AS gpa FROM students s JOIN enrollments e ON e.student_id = s.student_id WHERE e.grade_points IS NOT NULL GROUP BY s.student_id, s.home_campus_id HAVING count(*) >= 8) SELECT home_campus_id, student_id, round(gpa, 2) FROM g ORDER BY gpa DESC, student_id LIMIT 3',
      hint: 'Number the rows inside each campus, then keep the numbers 1 to 3 in an outer query. A window function cannot be filtered in the same SELECT that creates it.',
      concept: 'Top N per group is row_number in a CTE and a filter outside it.' },
    { id: '9.4', unit: 9, title: 'Compare with the row before', ordered: true,
      prompt: 'Show each term name, its number of enrollments, and the change from the term before it (empty for the first term), in term order.',
      solution: 'WITH n AS (SELECT t.term_id, t.name, count(*) AS enrolled FROM terms t JOIN sections s ON s.term_id = t.term_id JOIN enrollments e ON e.section_id = s.section_id GROUP BY t.term_id, t.name) SELECT name, enrolled, enrolled - lag(enrolled) OVER (ORDER BY term_id) FROM n ORDER BY term_id',
      alt: 'WITH n AS (SELECT t.term_id, t.name, count(*) AS enrolled FROM terms t JOIN sections s ON s.term_id = t.term_id JOIN enrollments e ON e.section_id = s.section_id GROUP BY t.term_id, t.name) SELECT a.name, a.enrolled, a.enrolled - b.enrolled FROM n a LEFT JOIN n b ON b.term_id = a.term_id - 1 ORDER BY a.term_id',
      wrong: 'WITH n AS (SELECT t.term_id, t.name, count(*) AS enrolled FROM terms t JOIN sections s ON s.term_id = t.term_id JOIN enrollments e ON e.section_id = s.section_id GROUP BY t.term_id, t.name) SELECT name, enrolled, enrolled - lead(enrolled) OVER (ORDER BY term_id) FROM n ORDER BY term_id',
      hint: 'LAG looks one row back in the window order.',
      concept: 'LAG and LEAD read a neighboring row, which turns a list of totals into a list of changes.' },

    { id: '10.1', unit: 10, title: 'Fill rate by campus', ordered: true,
      prompt: 'For term 6 sections that meet in a room, show each campus name, its total seats (the sum of section capacity), its total enrolled (enrollments that are not Withdrawn), and enrolled as a percent of seats rounded to 1 place. Highest percent first.',
      solution: "WITH per AS (SELECT s.section_id, s.room_id, s.capacity, (SELECT count(*) FROM enrollments e WHERE e.section_id = s.section_id AND e.status <> 'Withdrawn') AS n FROM sections s WHERE s.term_id = 6 AND s.room_id IS NOT NULL) SELECT c.name, sum(per.capacity), sum(per.n), round(100.0 * sum(per.n) / sum(per.capacity), 1) FROM per JOIN rooms r ON r.room_id = per.room_id JOIN campuses c ON c.campus_id = r.campus_id GROUP BY c.campus_id, c.name ORDER BY 4 DESC",
      alt: "WITH filled AS (SELECT section_id, count(*) AS n FROM enrollments WHERE status <> 'Withdrawn' GROUP BY section_id) SELECT c.name, sum(s.capacity) AS seats, sum(coalesce(f.n, 0)) AS enrolled, round(sum(coalesce(f.n, 0)) * 100.0 / sum(s.capacity), 1) AS pct FROM sections s JOIN rooms r ON r.room_id = s.room_id JOIN campuses c ON c.campus_id = r.campus_id LEFT JOIN filled f ON f.section_id = s.section_id WHERE s.term_id = 6 GROUP BY c.campus_id, c.name ORDER BY pct DESC",
      wrong: "SELECT c.name, sum(s.capacity), count(*), round(100.0 * count(*) / sum(s.capacity), 1) FROM sections s JOIN rooms r ON r.room_id = s.room_id JOIN campuses c ON c.campus_id = r.campus_id JOIN enrollments e ON e.section_id = s.section_id WHERE s.term_id = 6 AND e.status <> 'Withdrawn' GROUP BY c.campus_id, c.name ORDER BY 4 DESC",
      hint: 'If you join sections straight to enrollments, each section capacity is repeated once per student and the seat total balloons. Count per section first, then add up.',
      concept: 'Summing a value from the one side of a one to many join counts it many times. Aggregate to the right grain before joining.',
      tsql: 'SQL Server does not allow ORDER BY 4 on an expression position in every context and prefers the alias. The 100.0 matters in both systems: it forces decimal division.' },
    { id: '10.2', unit: 10, title: 'DFW rate by course', ordered: true,
      prompt: 'Count the enrollments whose status is Completed or Withdrawn. A DFW is a grade of D or F, or a Withdrawn status. For courses with at least 100 such enrollments show the title, the total, the DFW count, and DFW as a percent of the total rounded to 1 place. Show the 10 highest rates, highest first, with ties in title order.',
      solution: "SELECT c.title, count(*), sum(e.status = 'Withdrawn' OR e.grade IN ('D', 'F')), round(100.0 * sum(e.status = 'Withdrawn' OR e.grade IN ('D', 'F')) / count(*), 1) FROM enrollments e JOIN sections s ON s.section_id = e.section_id JOIN courses c ON c.course_id = s.course_id WHERE e.status IN ('Completed', 'Withdrawn') GROUP BY c.course_id, c.title HAVING count(*) >= 100 ORDER BY 4 DESC, c.title LIMIT 10",
      alt: "WITH o AS (SELECT s.course_id, CASE WHEN e.status = 'Withdrawn' THEN 1 WHEN e.grade = 'D' OR e.grade = 'F' THEN 1 ELSE 0 END AS dfw FROM enrollments e JOIN sections s ON s.section_id = e.section_id WHERE e.status <> 'Enrolled'), a AS (SELECT course_id, count(*) AS total, sum(dfw) AS dfw FROM o GROUP BY course_id HAVING count(*) >= 100) SELECT c.title, a.total, a.dfw, round(a.dfw * 100.0 / a.total, 1) AS rate FROM a JOIN courses c ON c.course_id = a.course_id ORDER BY rate DESC, c.title LIMIT 10",
      wrong: "SELECT c.title, count(*), sum(e.status = 'Withdrawn' OR e.grade IN ('D', 'F')), round(100 * sum(e.status = 'Withdrawn' OR e.grade IN ('D', 'F')) / count(*), 1) FROM enrollments e JOIN sections s ON s.section_id = e.section_id JOIN courses c ON c.course_id = s.course_id WHERE e.status IN ('Completed', 'Withdrawn') GROUP BY c.course_id, c.title HAVING count(*) >= 100 ORDER BY 4 DESC, c.title LIMIT 10",
      hint: 'Dividing one whole number by another throws away the decimals. Multiply by 100.0, not 100.',
      concept: 'Integer division truncates. A rate needs at least one decimal operand.',
      tsql: "SQL Server needs SUM(CASE WHEN ... THEN 1 ELSE 0 END) for the DFW count and TOP 10 instead of LIMIT 10. Integer division truncates there too." }
  ];

  C.exercise = function (id) {
    for (var i = 0; i < C.EXERCISES.length; i += 1) if (C.EXERCISES[i].id === id) return C.EXERCISES[i];
    return null;
  };

  /**
   * Grade one attempt. Runs both queries read only and records the attempt in _qd_clinic.
   * Returns { ok, reason, result, expectedShape: { columns, rows } }.
   * result is the learner's result set when the SQL ran, so the interface can show it either way.
   */
  C.check = function (project, exerciseId, sql) {
    var ex = C.exercise(exerciseId);
    if (!ex) throw new Error('Unknown exercise ' + exerciseId);
    var want = project.query(ex.solution, { history: false, maxRows: 20000 });
    var got = null, out;
    try {
      got = project.query(sql, { maxRows: 20000 });
      var cmp = QD.compareResults(got, want, { ordered: ex.ordered });
      out = { ok: cmp.match, reason: cmp.reason, result: got };
    } catch (e) {
      out = { ok: false, reason: e.message, result: null };
    }
    out.expectedShape = { columns: want.columns.length, rows: want.rows.length };
    var prev = project.objects('SELECT * FROM _qd_clinic WHERE exercise_id = ?', [ex.id])[0];
    var solved = (prev && prev.status === 'solved') || out.ok;
    project.db.run('INSERT INTO _qd_clinic (exercise_id, status, attempts, last_sql, solved_at) VALUES (?,?,?,?,?) ' +
      'ON CONFLICT(exercise_id) DO UPDATE SET status = excluded.status, attempts = _qd_clinic.attempts + 1, last_sql = excluded.last_sql, ' +
      'solved_at = coalesce(_qd_clinic.solved_at, excluded.solved_at)',
      [ex.id, solved ? 'solved' : 'tried', 1, String(sql), out.ok ? QD.now() : null]);
    project._touch('clinic');
    return out;
  };

  /** { byId: { '1.1': { status, attempts, lastSql, solvedAt } }, solved, total, units: [{ id, solved, total }] } */
  C.progress = function (project) {
    var byId = {};
    project.objects('SELECT * FROM _qd_clinic').forEach(function (r) {
      byId[r.exercise_id] = { status: r.status, attempts: r.attempts, lastSql: r.last_sql, solvedAt: r.solved_at };
    });
    var units = C.UNITS.map(function (u) {
      var list = C.EXERCISES.filter(function (e) { return e.unit === u.id; });
      return { id: u.id, total: list.length, solved: list.filter(function (e) { return byId[e.id] && byId[e.id].status === 'solved'; }).length };
    });
    return { byId: byId, total: C.EXERCISES.length, solved: units.reduce(function (s, u) { return s + u.solved; }, 0), units: units };
  };

  C.resetProgress = function (project) {
    project.db.run('DELETE FROM _qd_clinic');
    project._touch('clinic');
  };

  root.QDClinic = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);
/* QD:CLINIC END */
