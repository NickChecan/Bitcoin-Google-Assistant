'use strict';
 
const functions = require('firebase-functions');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
const requestAPI = require('request-promise');

process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  const agent = new WebhookClient({ request, response });
  console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
  console.log('Dialogflow Request body: ' + JSON.stringify(request.body));

  const conv = agent.conv(); // Get Action on Google library conv instance

  if (conv !== null && conv.data.bitcoinInvestment === undefined) {
    conv.data.bitcoinInvestment = 10000;
  }
 
  function welcome(agent) {
    agent.add(`Welcome to my agent!`);
  }
 
  function fallback(agent) {
    agent.add(`I didn't understand`);
    agent.add(`I'm sorry, can you try again?`);
  }

  function formatDate(date) {
    let month = date.getMonth() + 1;
    if ( month < 10 ) month = '0' + month;
    let day = date.getDate();
    if ( day < 10 ) day = '0' + day;
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function getBitcoinPrice(dateToRead) {
    //Example: https://api.coindesk.com/v1/bpi/historical/close.json?start=2019-07-30&end=2019-07-30&currency=eur
    return requestAPI('https://api.coindesk.com/v1/bpi/historical/close.json?start=' + dateToRead +
      '&end=' + dateToRead + '&currency=eur')
      .then(function (data) {
        let bitcoinPrice = JSON.parse(data);
        if (bitcoinPrice.hasOwnProperty('bpi') && bitcoinPrice['bpi'].hasOwnProperty(dateToRead)) {
          return bitcoinPrice['bpi'][dateToRead];
        }
      }).catch(function (err) {
        console.log('No bitcoin data');
        console.log(err);
      });
  }

  async function calculateInvestment(investDate, sellDate) {

    let investPrice = await getBitcoinPrice(investDate);
    let sellPrice = await getBitcoinPrice(sellDate);

    let startBitcoin = conv.data.bitcoinInvestment / investPrice;
    let earned = startBitcoin * sellPrice - conv.data.bitcoinInvestment;

    return {
        investPrice,
        sellPrice,
        startBitcoin,
        earned
    };

  }

  function formatMoney(num) {
    return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
  }

  async function earnWithBitcoinPeriod() {

    if (!agent.parameters.hasOwnProperty('buyDate')) {
      agent.add(conv);
      return;
    }

    let dateUnit = (agent.parameters['buyDate'].hasOwnProperty('date-unit')) ?
      agent.parameters['buyDate']['date-unit'] : false; // Day, month or year

    let datePeriod = (agent.parameters['buyDate'].hasOwnProperty('date-period')) ?
      agent.parameters['buyDate']['date-period'] : false; // Beginning or end

    let number = (agent.parameters['buyDate'].hasOwnProperty('number')) ?
      agent.parameters['buyDate']['number'] : 0;
    if ( !datePeriod && number === 0 ) number = 1; // A period ago

    let now = new Date();
    let dateToCalculate = new Date();

    switch (dateUnit) {

      case 'day':
        dateToCalculate.setDate(now.getDate() - number);
        break;
      
      case 'month':
        dateToCalculate.setMonth(now.getMonth() - number);
        if (datePeriod === 'end') {
          dateToCalculate.setDate(new Date(now.getFullYear(), dateToCalculate.getMonth() + 1, 0).getDate());
        } else if (datePeriod === 'beginning') {
          dateToCalculate.setDate(1);
        }
        break;

      case 'year':
        if (datePeriod === 'end') {
          dateToCalculate.setDate(31);
          dateToCalculate.setMonth(11);
        } else if (datePeriod === 'beginning') {
          dateToCalculate.setDate(1);
          dateToCalculate.setMonth(0);
        }
        
        if ( number > 2000 ) dateToCalculate.setFullYear(number);
        else if ( number < 20 ) {
          dateToCalculate.setFullYear(now.getFullYear() - number);
        }
        break;

    }
    
    let investDate = formatDate(dateToCalculate);
    now.setDate(now.getDate() - 1);
    let sellDate = formatDate(now);
    let investment = await calculateInvestment(investDate, sellDate);

    let earned = formatMoney(investment.earned.toFixed(2));

    let response = 'Investment price on ' + dateToCalculate.toDateString() +
      ' was: ' + formatMoney(investment.investPrice.toFixed(2)) + '. ' +
      'With the investment of : ' + formatMoney(conv.data.bitcoinInvestment) + ' EURO ' +
      'you would buy ' + investment.startBitcoin.toFixed(2) + ' bitcoins. ' +
      'Selling price yesterday would be ' + formatMoney(investment.sellPrice.toFixed(2)) + ' EURO. ' +
      'If you sold your ' + investment.startBitcoin.toFixed(2) + ' of bitcoins' +
      ' you would have earned: ' + earned + ' euros ';
    
    conv.ask(response);
    agent.add(conv);

  }

  // Run the proper function handler based on the matched Dialogflow intent name
  let intentMap = new Map();
  intentMap.set('Default Welcome Intent', welcome);
  intentMap.set('Default Fallback Intent', fallback);
  intentMap.set('Earn with Bitcoin in specific period', earnWithBitcoinPeriod);
  
  agent.handleRequest(intentMap);
});
