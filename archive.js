
/**
 *  update table 'poll' to contain every poll_ID (including live)
 *  update tables 'quesiton' and 'answer' to contain questions and possible answers
 *  get latest result for given poll_ID, and insert results into table 'votes',
    if the poll is currently live.
    /// In that case, also update field 'votes' in table 'poll' ///
*/

const request = require('request');
const cheerio = require('cheerio');

let MongoClient = require('mongodb').MongoClient;

const dbParams = require('./db-params.json');

const URL_ARCHIVE = 'http://services.runescape.com/m=poll/oldschool/archive.ws';
const URL_BASE_ARCHIVE_BY_YEAR = 'http://services.runescape.com/m=poll/oldschool/archive.ws?year=';
const URL_BASE_POLL = 'http://services.runescape.com/m=poll/oldschool/results.ws?id=';

var LIVE_POLL_ID = null;

const INTERVAL = 5;

function mongoQuery(collection, callback) {
    MongoClient.connect(dbParams.url, (err, db) => {
        if (err)
            console.error('%s [%d]', err.message, err.code);
        else {
            let coll = db.collection('poll');

            let promise = callback(coll);

            promise.then(
                () => {
                    db.close();
                },
                (err) => {
                    console.error('%s [%d]', err.message, err.code);
                    db.close();
                }
            );
        }
    });
}

function getAllPolls() {
    mongoQuery('poll', (coll) => {
        return new Promise((resolve, reject) => {

            coll.find({}).sort({ _id: 1 }).toArray((err, result) => {
                if (err)
                    reject(err);
                else {
                    result.map((el) => console.log('[%d] %s (%s)', el._id, el.title, el.date.toISOString()));
                    resolve();
                }
            });
        });
    });
}

function deleteAllPolls() {
    mongoQuery('poll', (coll) => {
        return new Promise((resolve, reject) => {

            coll.deleteMany({}, (err, result) => {
                if (err)
                    reject(err);
                else {
                    console.log(result.result);
                    resolve();
                }
            });
        });
    });
}

function insertPolls(pollArr) {
    mongoQuery('poll', (coll) => {
        return new Promise((resolve, reject) => {

            coll.insertMany(pollArr, (err, result) => {
                if (err)
                    reject(err);
                else {
                    console.log(result.result);
                    resolve();
                }
            });
        });
    });
}

/**
 * Updates table 'poll' with poll_IDs, titles and dates, from poll archive
 */
function updatePollArchive() {
    console.log('[archive] Updating poll archive.');
    request(URL_ARCHIVE, (error, response, html) => {
        if (error)
            console.log(error);
        else {
            let $ = cheerio.load(html);
            const years = $('div.archiveYears p').text().match(/[0-9]+/g);
            for (let i = 0; i < years.length; i++) {
                request(URL_BASE_ARCHIVE_BY_YEAR + years[i], (error, response, html) => {
                    if (error)
                        console.log(error);
                    else {
                        let $ = cheerio.load(html);
                        let pollCount = $('.widescroll-content table tr').length;

                        let pollArr = [];
                        for (let j = 0; j < pollCount; j++) {
                            let poll = {
                                _id: parseInt($('.widescroll-content table tr .td80percent a').eq(j).attr('href').replace('results.ws?id=', '')),
                                title: $('.widescroll-content table tr .td80percent a').eq(j).text().replace('\uFFFD', '-'),
                                date: dateStringToISO($('.widescroll-content table tr .td20percent').eq(j).text())
                            };
                            pollArr.push(poll);
                        }
                        insertPolls(pollArr);
                    }
                });
            }
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
function dateStringToISO(dateString) {
    let patt = /(\d\d)-(\w\w\w)-(\d\d\d\d) (\d\d:\d\d:\d\d)/g;
    let match = patt.exec(dateString);
    let date = new Date(match[3] + '-' + dates[match[2]] + '-' + match[1] + ' ' + match[4]);
    return date;
}

let startupActionSeq = [
    // updatePollArchive
    getAllPolls
    // deleteAllPolls
]
for (let i = 0; i < startupActionSeq.length; i++) {
    setTimeout(startupActionSeq[i], i * 1000);
}
