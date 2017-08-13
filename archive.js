
/**
 *  update table 'poll' to contain every poll_ID (including live)
 *  update tables 'quesiton' and 'answer' to contain questions and possible answers
 *  get latest result for given poll_ID, and insert results into table 'votes',
    if the poll is currently live.
*/

const request = require('request');
const cheerio = require('cheerio');
const mysql = require('mysql');

const log = require('npmlog');
log.level = process.env.LOG_LEVEL;

const dbParams = require('./db-params.json');

const URL_ARCHIVE = 'http://services.runescape.com/m=poll/oldschool/archive.ws';
const URL_BASE_ARCHIVE_BY_YEAR = 'http://services.runescape.com/m=poll/oldschool/archive.ws?year=';
const URL_BASE_POLL = 'http://services.runescape.com/m=poll/oldschool/results.ws?id=';

var LIVE_POLL_ID = null;

const INTERVAL = 5;

function dbConnection(callback) {
    let connection = mysql.createConnection(dbParams);
    let cbPromise = new Promise((resolve, reject) => {
        callback(connection, resolve, reject)
    });

    cbPromise
        .then(() => connection.end())
        .catch((err) => {
            if (err.message) log.error('[archive]', err.message);
            else if (err.code) log.error('[archive]', err.code);
            else if (err) log.error('[archive]', err);
            connection.end();
        });
}

function insertPolls(polls) {
    dbConnection((connection, resolve, reject) => {

        connection.query('INSERT IGNORE INTO poll (poll_ID, title, date) VALUES ?', [polls], (err, results) => {
            if (err) {
                reject(err);
            } else {
                log.verbose('[archive]', 'Inserted %d polls.', results.affectedRows);
                resolve();
            }
        });
    });
}

function insertQuestions(questions) {
    return new Promise((insertResolve, insertReject) => {
        dbConnection((connection, resolve, reject) => {

            connection.query('INSERT IGNORE INTO question (poll_ID, question_ID, question_text, question_type) VALUES ?', [questions], (err, results) => {
                if (err) {
                    reject(err);
                    insertReject(err);
                } else {
                    log.verbose('[archive]', 'Inserted %d questions.', results.affectedRows);
                    resolve();
                    insertResolve();
                }
            });
        });
    });
}

function insertAnswers(answers) {
    return new Promise((insertResolve, insertReject) => {
        dbConnection((connection, resolve, reject) => {

            connection.query('INSERT IGNORE INTO answer (poll_ID, question_ID, answer_ID, answer_text) VALUES ?', [answers], (err, results) => {
                if (err) {
                    reject(err);
                    insertReject(err);
                } else {
                    log.verbose('[archive]', 'Inserted %d answers.', results.affectedRows);
                    resolve();
                    insertResolve();
                }
            });
        });
    });
}

function insertVotes(votes) {

    dbConnection((connection, resolve, reject) => {
        connection.query('INSERT IGNORE INTO votes (poll_ID, question_ID, answer_ID, amount, data_time) VALUES ?', [votes], (err, results) => {
            if (err) {
                reject(err);
            } else {
                log.verbose('[archive]', 'Inserted results for %d answers.', results.affectedRows);
                resolve();
            }
        });
    });
}

let newPollResolves = {
    POLL_NEW: 0,
    POLL_ONGOING: 2,
    POLL_NONE: 3
}

/**
 * Fetches and stores live poll id, if present
 */
function getLivePollId() {
    return new Promise((resolve, reject) => {
        request('http://services.runescape.com/m=poll/oldschool/index.ws', (error, response, html) => {

            if (error) {
                reject(error);

            } else {

                var $ = cheerio.load(html);
                var id = $('div.current a').attr('href');
                if (id) {
                    var newLivePoll = id.replace('results.ws?id=', '');
                    if (newLivePoll != LIVE_POLL_ID) {
                        LIVE_POLL_ID = newLivePoll;
                        resolve(newPollResolves.POLL_NEW);
                    } else
                        resolve(newPollResolves.POLL_ONGOING);

                } else if (LIVE_POLL_ID) {
                    resolve(LIVE_POLL_ID);
                    LIVE_POLL_ID = null;

                } else {
                    resolve(newPollResolves.POLL_NONE);
                }
            }
        });
    });
}

/**
 * Adds live poll to the poll archive
 */
function addLiveToArchive() {
    return new Promise((resolve, reject) => {

        request(URL_BASE_POLL + LIVE_POLL_ID, (error, response, html) => {
            if (error)
                reject(error)
            else {
                let $ = cheerio.load(html);
                let fullTitle = $('div.widescroll-content h2').text();
                let date = dateStringToISO(fullTitle);
                let title = fullTitle.substring(0, fullTitle.length - date.length - 3);
                let poll = {
                    poll_ID: LIVE_POLL_ID,
                    title: title,
                    date: date
                };
                log.verbose('[archive]', 'Adding live poll to the archive.');
                dbConnection((connection, resolveDb, rejectDb) => {
                    connection.query('INSERT IGNORE INTO poll SET ?', poll, (err) => {
                        if (err) {
                            rejectDb(err);
                            reject();
                        } else {
                            log.info('[archive]', 'Successful insert of live poll \'%d\'', poll.poll_ID);
                            resolveDb();
                            resolve();
                        }
                    });
                });
            }
        });
    });
}

/**
 * Updates table 'poll' with poll_IDs, titles and dates, from poll archive
 */
function updatePollArchive() {
    log.info('[archive]', 'Updating poll archive.');

    request(URL_ARCHIVE, (error, response, html) => {
        if (error)
            log.error(error.message);
        else {
            let $ = cheerio.load(html);
            let years = $('div.archiveYears p').text().match(/[0-9]+/g);
            for (let i = 0; i < years.length; i++) {
                request(URL_BASE_ARCHIVE_BY_YEAR + years[i], (error, response, html) => {
                    if (error)
                        log.error(error.message);
                    else {
                        let $ = cheerio.load(html);
                        let pollCount = $('.widescroll-content table tr').length;

                        let polls = [];

                        for (let j = 0; j < pollCount; j++) {
                            let poll = [
                                $('.widescroll-content table tr .td80percent a').eq(j).attr('href').replace('results.ws?id=', ''), // id
                                $('.widescroll-content table tr .td80percent a').eq(j).text().replace('\uFFFD', '-'), // title
                                dateStringToISO($('.widescroll-content table tr .td20percent').eq(j).text()) // date
                            ];

                            polls.push(poll);
                        }

                        insertPolls(polls);
                    }
                });
            }
        }
    });
}

/**
 * Updates tables 'question', 'answer', and 'votes' with questions,
 * answers and results, for poll_IDs from 'poll'
 */
function updateArchivedPolls() {
    log.info('[archive]', 'Updating archived polls.');
    let sql = `
        SELECT poll_ID FROM poll
        WHERE
            poll_ID != ${(LIVE_POLL_ID ? LIVE_POLL_ID : 0)} AND
            poll_ID NOT IN (SELECT DISTINCT poll_ID FROM votes);`;

    dbConnection((connection, resolve, reject) => {
        connection.query(sql, (err, rows, fields) => {
            if (err)
                reject(err);
            else {
                for (let i = 0; i < rows.length; i++) {
                    setTimeout(function () {
                        parsePollQuestions(rows[i].poll_ID)
                            .then(() => {
                                parsePollResults(rows[i].poll_ID, false);
                            })
                            .catch(() => { });
                    }, i * 200);
                }
                resolve();
            }
        });
    });
}

/**
 * Updates tables 'question' and 'answer' with questions and possible answers for given poll_ID
 * @param {number} poll_ID
 */
function parsePollQuestions(poll_ID) {
    return new Promise((resolve, reject) => {

        request(URL_BASE_POLL + poll_ID, (error, response, html) => {

            if (error) {
                log.error(error.message);
                return;
            }

            if (response.statusCode != 200) {
                log.warn('[archive]', 'Could not GET data for poll %d. Retrying in 5 seconds.', poll_ID);
                setTimeout(() => {
                    parsePollById(poll_ID, isLive);
                }, 5000);
                return;
            }

            let $ = cheerio.load(html);

            let questions = [];
            let answers = [];

            /*
            if (!isLive)
                let totalVotes = $('.widescroll-content div b').text().match(/\d+/)[0];
            */

            let questionCount = $('fieldset.question').length;
            for (let q = 0; q < questionCount; q++) {

                questions.push([
                    poll_ID,
                    q + 1,
                    $('fieldset.question').eq(q).find('b').text(),
                    ($('fieldset.question').eq(q).find('table tr').eq(0).find('td').eq(0).text() == 'Yes' &&
                        $('fieldset.question').eq(q).find('table tr').eq(1).find('td').eq(0).text() == 'No' ? 'yes_no' : 'other')
                ]);

                let answerCount = $('fieldset.question').eq(q).find('table tr').length
                for (let a = 0; a < answerCount; a++) {

                    if ($('fieldset.question').eq(q).find('table tr').eq(a).find('td').length == 3) {
                        answers.push([
                            poll_ID,
                            q + 1,
                            a + 1,
                            $('fieldset.question').eq(q).find('table tr').eq(a).find('td').eq(0).text().replace('/\'/g', '')
                        ]);
                    }
                }
            }

            insertQuestions(questions)
                .then(() => {
                    insertAnswers(answers)
                        .then(() => { resolve() })
                        .catch((err) => { });
                })
                .catch((err) => { });
        });
    });
}

/**
 * Inserts results for poll with poll_ID into table 'votes'
 * @param {number} poll_ID 
 * @param {boolean} isLive 
 */
function parsePollResults(poll_ID, isLive) {

    request(URL_BASE_POLL + poll_ID, (error, response, html) => {

        if (error) {
            log.error(error.message);
            return;
        }

        if (response.statusCode != 200) {
            log.warn('[archive]', 'Could not GET data for poll %d. Retrying in 5 seconds.', poll_ID);
            setTimeout(() => {
                parsePollById(poll_ID, isLive);
            }, 5000);
            return;
        }

        let date;
        if (isLive)
            date = new Date(response.headers.date).toISOString();
        else
            date = null;

        let $ = cheerio.load(html);

        let votes = [];

        let questionCount = $('fieldset.question').length;
        for (let q = 0; q < questionCount; q++) {

            let answerCount = $('fieldset.question').eq(q).find('table tr').length
            for (let a = 0; a < answerCount; a++) {

                if ($('fieldset.question').eq(q).find('table tr').eq(a).find('td').length == 3) {
                    votes.push([
                        poll_ID,
                        q + 1,
                        a + 1,
                        parseInt((/\((\d*) votes\)/g).exec($('fieldset.question').eq(q).find('table tr').eq(a).find('td').eq(2).text())[1]),
                        date
                    ]);
                }
            }
        }
        insertVotes(votes);

    });
}

const dates = {
    'Jan': '01',
    'Feb': '02',
    'Mar': '03',
    'Apr': '04',
    'May': '05',
    'Jun': '06',
    'Jul': '07',
    'Aug': '08',
    'Sep': '09',
    'Oct': '10',
    'Nov': '11',
    'Dec': '12'
}
function dateStringToISO(dateString) {
    var patt = /(\d\d)-(\w\w\w)-(\d\d\d\d) (\d\d:\d\d:\d\d)/g
    var match = patt.exec(dateString)
    return match[3] + '-' + dates[match[2]] + '-' + match[1] + ' ' + match[4]
}

/**
 * 
 * @param {number} minute - Delay between callback calls (starting at XXh:00m:00s)
 * @callback callback
 */
function runAtMinute(minute, callback) {
    let curMs = Date.now() % 3600000;
    let delayMs = minute * 60000 - curMs % (minute * 60000);
    setTimeout(function action() {
        callback();
        setTimeout(action, minute * 60000);
    }, delayMs);
}

function startLivePollParser() {
    log.info('[archive]', 'Starting live poll parser');
    runAtMinute(INTERVAL, () => {
        let livePromise = getLivePollId();
        livePromise
            .then((status) => {
                if (status === newPollResolves.POLL_NEW) {
                    log.info('[archive]', 'New poll with ID %d went live!', LIVE_POLL_ID);
                    addLiveToArchive()
                        .then(() => {
                            parsePollQuestions(LIVE_POLL_ID)
                                .then(() => {
                                    parsePollResults(LIVE_POLL_ID, true);
                                })
                                .catch(() => { });
                        })
                        .catch(() => { });

                } else if (status === newPollResolves.POLL_ONGOING) {
                    log.verbose('[archive]', 'Parsing poll results for live poll %d.', LIVE_POLL_ID);
                    parsePollResults(LIVE_POLL_ID, true);
                } else if (status === newPollResolves.POLL_NONE) {
                    log.verbose('[archive]', 'No currently live polls.');
                } else {
                    log.info('[archive]', 'Poll with ID %d has now ended.', status);
                }
            })
            .catch((error) => {
                log.error('[archive]', '%s', error.message);
            });
        ;
    });
}

let startupActionSeq = [
    updatePollArchive,
    updateArchivedPolls,
    startLivePollParser
]
for (let i = 0; i < startupActionSeq.length; i++) {
    setTimeout(startupActionSeq[i], i * 2500);
}