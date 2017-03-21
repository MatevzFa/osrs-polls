
/*
 *  update table 'poll' to contain every poll_ID (including live)
 *  update tables 'quesiton' and 'answer' to contain questions and possible answers
 *  get latest result for given poll_ID, and insert results into table 'votes',
    if the poll is currently live. In that case, also update field 'votes' in
    table 'poll'
*/

const request = require('request');
const cheerio = require('cheerio');
const mysql = require('mysql');


const dbParams = require('./db-params.json');
const connection = mysql.createConnection(dbParams);
connection.connect();

const URL_ARCHIVE = 'http://services.runescape.com/m=poll/oldschool/archive.ws';
const URL_BASE_ARCHIVE_BY_YEAR = 'http://services.runescape.com/m=poll/oldschool/archive.ws?year=';
const URL_BASE_POLL = 'http://services.runescape.com/m=poll/oldschool/results.ws?id=';

var LIVE_POLL_ID = null;

function getLivePollId () {
  request('http://services.runescape.com/m=poll/oldschool/index.ws', (error, response, html) => {
    if (!error) {
      var $ = cheerio.load(html);
      var id = $('div.current a').attr('href');
      if (id) {
        var newLivePoll = id.replace('results.ws?id=', '');
        if (newLivePoll != LIVE_POLL_ID) {
          LIVE_POLL_ID = newLivePoll;
          console.log('[archive] New Live poll with ID %d.', LIVE_POLL_ID);
          addLiveToArchive();
        } else {
          console.log('[archive] Poll with ID %d still live.', LIVE_POLL_ID);
        }
      } else if (LIVE_POLL_ID) {
        console.log('[archive] Poll with ID %d has now closed.', LIVE_POLL_ID);
        LIVE_POLL_ID = null;
      } else {
        console.log('[archive] No live polls.');
      }
    } else {
      console.log(error);
    }
  });
}

function addLiveToArchive() {
  request(URL_BASE_POLL + LIVE_POLL_ID, (error, response, html) => {
    if (error) console.log(error);
    else {
      let $ = cheerio.load(html);
      let fullTitle = $('div.widescroll-content h2').text();
      let date = dateStringToISO(fullTitle);
      let title = fullTitle.substring(0, fullTitle.length - date.length - 3);
      let poll = {
        title: title,
        poll_ID: LIVE_POLL_ID,
        date: date
      };
      connection.query('INSERT INTO poll SET ?', poll, (error) => {
        if (error && error.code !== 'ER_DUP_ENTRY') console.log(error.message);
        else if (error && error.code === 'ER_DUP_ENTRY') console.log(`[archive] live poll '${poll.poll_ID}' has already been archived`);
        else if (!error) console.log(`[archive] successful insert of live poll '${poll.poll_ID}'`);
      });
    }
  });
}

/*
 * Updates table 'poll' with poll_IDs, titles and dates, from poll archive
*/
function updatePollArchive () {
  console.log('[archive] Updating poll archive.');
  request(URL_ARCHIVE, (error, response, html) => {
    if (error) console.log(error);
    else {
      var $ = cheerio.load(html);
      const years = $('div.archiveYears p').text().match(/[0-9]+/g);
      for (let i = 0; i < years.length; i++) {
        request(URL_BASE_ARCHIVE_BY_YEAR + years[i], (error, response, html) => {
          if (error) console.log(error);
          else {
            var $ = cheerio.load(html);
            var pollCount = $('.widescroll-content table tr').length;

            for (let j = 0; j < pollCount; j++) {
              let poll = {
                title: $('.widescroll-content table tr .td80percent a').eq(j).text().replace('\uFFFD', '-'),
                poll_ID: $('.widescroll-content table tr .td80percent a').eq(j).attr('href').replace('results.ws?id=', ''),
                date: dateStringToISO($('.widescroll-content table tr .td20percent').eq(j).text())
              };
              connection.query('INSERT INTO poll SET ?', poll, (error) => {
                if (error && error.code !== 'ER_DUP_ENTRY') console.log(error.message);
                else if (!error) {
                  console.log(`[archive] successful insert of poll '${poll.poll_ID}'`);
                  parsePollById(poll.poll_ID, false);
                }
              });
              connection.query(`UPDATE poll SET date = '${poll.date}' WHERE poll_ID = ${poll.poll_ID} AND date != '${poll.date}'`, (error, fields) => {
                // console.log(fields);
                if (error) console.log(error.message);
                else if (fields.affectedRows != 0) console.log(`[archive] successful update of date for poll '${poll.poll_ID}'`);
              });
            }
          }
        });
      }
    }
  });
}

/*
 * Updates tables 'question', 'answer', and 'votes' with questions,
 * answers and results, for poll_IDs from 'poll'
*/
function updateArchivedPolls() {
  console.log('[archive] Updating archived polls.');
  connection.query(`SELECT * FROM poll WHERE poll_ID != ${( LIVE_POLL_ID ? LIVE_POLL_ID : 0 )}`, (error, rows, fields) => {
    if (error) console.log(error)
    else {
      for (let i = 0; i < rows.lenght; i++) {
        parsePollById(rows[i].poll_ID, false);
      }
    }
  });
}

/*
 * Updates tables 'question' and 'answer' with questions and possible answers for given poll_ID
*/
function parsePollById (poll_ID, isLive) {
  console.log('Parsing poll with id %d', poll_ID);
  request(URL_BASE_POLL + poll_ID, (error, response, html) => {

    let date;
    if (isLive) {
      date = new Date(response.headers.date).toISOString();
    } else {
      date = null;
    }

    if (response.statusCode != 200) {
      console.log('[archive] Response for poll %d : %d - %s', poll_ID, response.statusCode, response.statusMessage);
      return;
    }

    if (error) console.log(error);
    else {
      let $ = cheerio.load(html);

      let questions = []
      let answers = [];
      let votes = [];

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
            votes.push([
              poll_ID,
              q + 1,
              a + 1,
              parseInt( (/\((\d*) votes\)/g).exec($('fieldset.question').eq(q).find('table tr').eq(a).find('td').eq(2).text())[1] ),
              date
            ]);
          }
        }
      }

      connection.query('INSERT INTO question (poll_ID, question_ID, question_text, question_type) VALUES ?', [questions], (error) => {
        if (error && error.code !== 'ER_DUP_ENTRY')
          console.log(error);
        else if (!error || error.code === 'ER_DUP_ENTRY') {
          if (error && error.code !== 'ER_DUP_ENTRY') {
            console.log(`[archive] successful insert of questions for poll '${poll_ID}'`);
          }

          connection.query('INSERT INTO answer (poll_ID, question_ID, answer_ID, answer_text) VALUES ?', [answers], (error) => {
            if (error && error.code !== 'ER_DUP_ENTRY')
              console.log(error);
            else if (!error || error.code === 'ER_DUP_ENTRY') {
              if (error && error.code !== 'ER_DUP_ENTRY') {
                console.log(`[archive] successful insert of answers for poll '${poll_ID}'`);
              }

              connection.query('INSERT INTO votes (poll_ID, question_ID, answer_ID, amount, data_time) VALUES ?', [votes], (error) => {
                if (error && error.code !== 'ER_DUP_ENTRY')
                  console.log(error);
                else if (!error)
                  console.log(`[archive]${(isLive ? ' [' + date.substring(11, 19) + '] ' : '')}successful insert of votes for poll '${poll_ID}'`);
              });
            }
          });
        }
      });
    }
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
function dateStringToISO (dateString) {
  var patt = /(\d\d)-(\w\w\w)-(\d\d\d\d) (\d\d:\d\d:\d\d)/g
  var match = patt.exec(dateString)
  return match[3] + '-' + dates[match[2]] + '-' + match[1] + ' ' + match[4]
}

/*
 * Calls callback function every 'minute' minutes (relative to XXh 00min 00s)
*/
function runAtMinute (minute, callback) {
  let curMs = Date.now() % 3600000;
  let delayMs = minute * 60000 - curMs % (minute * 60000);
  setTimeout(function action() {
    callback();
    setTimeout(action, minute * 60000);
  }, delayMs);
}

function startLivePollParser () {
  console.log('[archive] Starting live poll parser');
  runAtMinute(15, () => {
    parsePollById(LIVE_POLL_ID, true);
  });
}

// updateArchivedPolls();
let startupActionSeq = [
  getLivePollId,
  updatePollArchive,
  // updateArchivedPolls,
  startLivePollParser
]
for (let i = 0; i < startupActionSeq.length; i++) {
  setTimeout(startupActionSeq[i], i * 1000);
}

// parsePollById(1343, false);
