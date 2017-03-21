
if (!process.env.PORT) {
  process.env.PORT = 8080
}

const express = require('express');
const mysql = require('mysql');
const app = express();

const dbParams = require('./db-params.json');
const connection = mysql.createConnection(dbParams);
connection.connect();

var years = [];

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('./public'));

app.get('/', (req, res) => {
  console.log('[server] Connection to \'%s\' from %s', req.url, req.ip);
  connection.query('SELECT poll_ID FROM poll ORDER BY date DESC LIMIT 1', (err, rows, fields) => {
    if (err) console.log(err.message)
    else renderPollById(rows[0].poll_ID, req, res)
  });
});

app.get('/poll/:pollId', (req, res) => {
  console.log('[server] Connection to \'%s\' from %s', req.url, req.ip);
  renderPollById(req.params.pollId, req, res);
});

app.get('/archive/:year*?', (req, res) => {
  console.log('[server] Connection to \'%s\' from %s', req.url, req.ip);
  if (req.params.year && !isNaN(req.params.year)) {
    var sql = `
      SELECT * FROM poll
      WHERE YEAR(date) = ${req.params.year}
      ORDER BY date ASC`;
    connection.query(sql, (err, rows, fields) => {
      if (err) throw err;
      else res.render('archive', { archive: rows, years: years });
    });
  } else {
    sql = `SELECT * FROM poll`;
    connection.query(sql, (err, rows, fields) => {
      if (err) throw err;
      else res.render('archive', { archive: rows, years: years });
    });
  }
});

app.listen(process.env.PORT, () => {
  console.log('[server] Server up.');
});


function renderPollById (pollId, req, res) {
  var sql = `
    SELECT * FROM poll
    WHERE poll_ID = ${pollId};`;
  connection.query(sql, (err, pollData, fields) => {
    if (err) console.log(err.message);
    else {
      var sql = `
        SELECT * FROM question
        WHERE poll_ID = ${pollId};`;
      connection.query(sql, (err, questions, fields) => {
        if (err) console.log(err.message);
        else {
          var sql = `
            SELECT question_ID, answer_text, amount FROM answer NATURAL JOIN votes
            WHERE poll_ID = ${pollId} AND data_time IN (
              SELECT MAX(data_time) FROM votes
              WHERE poll_ID = ${pollId}
            );`;
          connection.query(sql, (err, answers, fields) => {
            if (err) console.log(err.message);
            else {
              var poll = {
                title: pollData[0].title,
                votes: -1,
                date: pollData[0].date.toDateString().substring(4),
                results: []
              };
              let minVotes = 1000000;
              for (var i = 0; i < questions.length; i++) {
                let curQuestion = {
                  question: questions[i].question_text,
                  type: questions[i].question_type,
                  skipIdx: -1,
                  answers: answers.filter(function (a) { return a.question_ID === i + 1 })
                };
                poll.results.push(curQuestion);
                let thisQVotes = 0;
                for (let a = 0; a < curQuestion.answers.length; a++) {
                  if (curQuestion.answers[a].answer_text === 'Skip question')
                    curQuestion.skipIdx = a;
                  thisQVotes += curQuestion.answers[a].amount;
                }
                if (thisQVotes < minVotes) {
                  minVotes = thisQVotes;
                }
              }
              poll.votes = minVotes;
              res.render('index', { poll: poll, additionalInfo: null });
            }
          });
        }
      });
    }
  });
}

function getYears () {
  connection.query('SELECT DISTINCT YEAR(date) as year FROM poll', (error, rows, fields) => {
    if (error) console.log(error);
    else {
      for (let i = 0; i < rows.length; i++)
        years.push(rows[i].year);
      console.log('[server] Found years %s', years.join(", "));
    }
  })
}

getYears();
