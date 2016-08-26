/*jshint debug:true, noarg:true, noempty:true, eqeqeq:true, bitwise:true, undef:true, curly:true, browser: true, devel: true, jquery:true, strict:true */
/*global  Backbone, Skeletor, _, jQuery, Rollcall, google, Paho */

(function() {
  "use strict";
  var Skeletor = this.Skeletor || {};
  this.Skeletor.Mobile = this.Skeletor.Mobile || new Skeletor.App();
  var Model = this.Skeletor.Model;
  Skeletor.Model = Model;
  var app = this.Skeletor.Mobile;


  app.config = null;
  app.requiredConfig = {
    drowsy: {
      url: 'string',
      db: 'string',
      username: 'string',
      password: 'string'
    },
    wakeful: {
      url: 'string'
    },
    login_picker:'boolean',
    runs:'object'
  };

  var DATABASE = null;

  app.rollcall = null;
  app.runId = null;
  app.runState = null;
  app.users = null;
  app.username = null;
  app.currentUser = null;
  app.lesson = null;
  app.contributions = [];

  app.notesReadView = null;
  app.notesWriteView = null;
  app.definitionView = null;
  app.relationshipView = null;
  app.vettingView = null;

  app.keyCount = 0;
  app.autoSaveTimer = window.setTimeout(function() { } ,10);

  app.state = [];

  app.init = function() {
    /* CONFIG */
    app.loadConfig('../config.json');
    app.verifyConfig(app.config, app.requiredConfig);

    // Adding BasicAuth to the XHR header in order to authenticate with drowsy database
    // this is not really big security but a start
    var basicAuthHash = btoa(app.config.drowsy.username + ':' + app.config.drowsy.password);
    Backbone.$.ajaxSetup({
      beforeSend: function(xhr) {
        return xhr.setRequestHeader('Authorization',
          // 'Basic ' + btoa(username + ':' + password));
          'Basic ' + basicAuthHash);
      }
    });

    // hide all rows initially
    app.hideAllContainers();

    app.handleLogin();
  };

  app.handleLogin = function () {
    if (jQuery.url().param('runId') && jQuery.url().param('username')) {
      console.log ("URL parameter correct :)");
      app.runId = jQuery.url().param('runId');
      app.username = jQuery.url().param('username');
    } else {
      // retrieve user name from cookie if possible otherwise ask user to choose name
      app.runId = jQuery.cookie('brainstorm_mobile_runId');
      app.username = jQuery.cookie('brainstorm_mobile_username');
    }

    if (app.username && app.runId) {
      // We have a user in cookies so we show stuff
      console.log('We found user: '+app.username);

      // this needs runId
      setDatabaseAndRollcallCollection();

      // make sure the app.users collection is always filled
      app.rollcall.usersWithTags([app.runId])
      .done(function (usersInRun) {
        console.log(usersInRun);

        if (usersInRun && usersInRun.length > 0) {
          app.users = usersInRun;

          // sort the collection by username
          app.users.comparator = function(model) {
            return model.get('username');
          };
          app.users.sort();

          app.currentUser = app.users.findWhere({username: app.username});

          if (app.currentUser) {
            jQuery('.username-display a').text(app.runId+"'s class - "+app.currentUser.get('display_name'));

            hideLogin();
            showUsername();

            app.setup();
          } else {
            console.log('User '+usersInRun+' not found in run '+app.runId+'. Show login picker!');
            logoutUser();
          }
        } else {
          console.log("Either run is wrong or run has no users. Wrong URL or Cookie? Show login");
          // fill modal dialog with user login buttons
          logoutUser();
        }
      });
    } else {
      console.log('No user or run found so prompt for username and runId');
      hideUsername();
      // fill modal dialog with user login buttons
      if (app.config.login_picker) {
        hideLogin();
        showRunPicker();
      } else {
        showLogin();
        hideUserLoginPicker();
      }
    }

    // click listener that sets username
    jQuery('#login-button').click(function() {
      app.loginUser(jQuery('#username').val());
      // prevent bubbling events that lead to reload
      return false;
    });
  };

  app.setup = function() {
    Skeletor.Model.init(app.config.drowsy.url, DATABASE)
    .then(function () {
      console.log('Model initialized - now waking up');
      return Skeletor.Model.wake(app.config.wakeful.url);
    })
    .then(function() {
      // run state used for pausing/locking the tablet
      console.log('State model initialized - now waking up');
      app.runState = Skeletor.getState('RUN');
      app.runState.wake(app.config.wakeful.url);
      app.runState.on('change', app.reflectRunState);
    })
    .done(function () {
      ready();
      console.log('Models are awake - now calling ready...');
    });
  };

  var ready = function() {
    setUpUI();
    setUpClickListeners();
    wireUpViews();

    // decide on which screens to show/hide
    app.hideAllContainers();

    app.reflectRunState();
  };

  var setUpUI = function() {
    /* MISC */
    jQuery().toastmessage({
      position : 'middle-center'
    });

    jQuery('.brand').text("CK Biology 2016");
  };

  var setUpClickListeners = function () {
    // click listener that logs user out
    jQuery('#logout-user').click(function() {
      logoutUser();
    });

    jQuery('.choose-lesson-btn').click(function(ev) {
      if (app.username) {
        // check which lesson from data value
        app.lesson = jQuery(ev.target).data('lesson');
        buildContributionArray();
        app.hideAllContainers();
        jQuery('#home-screen').removeClass('hidden');
        jQuery('#navivation-bar').removeClass('hidden');
      }
    });

    jQuery('.top-nav-btn, .home-screen-btn').click(function() {
      if (app.username) {
        jQuery('.top-nav-btn').removeClass('active');     // unmark all nav items
        if (jQuery(this).hasClass('goto-notes-btn')) {
          app.hideAllContainers();
          jQuery('#notes-nav-btn').addClass('active');
          jQuery('#notes-read-screen').removeClass('hidden');
        } else if (jQuery(this).hasClass('goto-home-btn')) {
          app.hideAllContainers();
          jQuery('#home-nav-btn').addClass('active');
          jQuery('#home-screen').removeClass('hidden');
        } else if (jQuery(this).hasClass('goto-contribution-btn')) {
          app.hideAllContainers();
          jQuery('#contribution-nav-btn').addClass('active');
          app.determineNextStep();
        } else if (jQuery(this).hasClass('goto-knowledge-base-btn')) {
          app.hideAllContainers();
          jQuery('#knowledge-base-nav-btn').addClass('active');
          jQuery('#knowledge-base-screen').removeClass('hidden');
        } else {
          console.log('ERROR: unknown nav button');
        }
      }
    });
  };

  var wireUpViews = function() {
    /* ======================================================
     * Setting up the Backbone Views to render data
     * coming from Collections and Models.
     * This also takes care of making the nav items clickable,
     * so these can only be called when everything is set up
     * ======================================================
     */


    if (app.notesReadView === null) {
      app.notesReadView = new app.View.NotesReadView({
        el: '#notes-read-screen',
        collection: Skeletor.Model.awake.notes
      });

      app.notesReadView.render();
    }

    if (app.notesWriteView === null) {
      app.notesWriteView = new app.View.NotesWriteView({
        el: '#notes-write-screen',
        collection: Skeletor.Model.awake.notes
      });
    }

    if (app.definitionView === null) {
      app.definitionView = new app.View.DefinitionView({
        el: '#definition-screen',
        collection: Skeletor.Model.awake.terms
      });
    }

    // if (app.relationshipsView === null) {
    //   app.relationshipsView = new app.View.RelationshipsView({
    //     el: '#relationships-screen',
    //     collection: Skeletor.Model.awake.relationships
    //   });
    // }

    // if (app.vettingView === null) {
    //   app.vettingView = new app.View.VettingView({
    //     el: '#vetting-screen',
    //     collection: Skeletor.Model.awake.terms
    //   });
    // }

  };


  //*************** HELPER FUNCTIONS ***************//

  var buildContributionArray = function() {
    // get all terms, push those with app.lesson and assigned_to === app.username
    Skeletor.Model.awake.terms.each(function(term) {
      if (term.get('lesson') === app.lesson && term.get('assigned_to') === app.username) {
        var obj = {};
        obj.kind = 'term';
        obj.content = term;
        app.contributions.push(obj);
      }
    });

    // get all relationships with app.lesson and assigned_to === app.username

    // THIS LAST PART WILL NEED TO BE BUILT ON THE FLY - EG CANT USE THIS STRUCTURE, SINCE PEOPLE WILL BE DOING THIS AT THE SAME TIME
    // get all users to determine class size
    // divide # of terms by # of users, rounding up
    // push that number of terms with lowest review_count and assigned_to !== app.username


  };

  app.determineNextStep = function() {
    console.log('Determining next step...');

    var task = app.nextContribution();

    if (task.kind == "term") {
      jQuery('#definition-screen').removeClass('hidden');
      updateDefinitionView();
    } else if (task.kind == "relationship") {
      jQuery('#relationship-screen').removeClass('hidden');
    } else if (task.kind == "vetting") {        // this will eventually change to accom multiple simultaneous users
      jQuery('#vetting-screen').removeClass('hidden');
    }
  }

  app.nextContribution = function() {
    return _.first(app.contributions);
  };

  var updateDefinitionView = function() {
    var definition = app.nextContribution().content;
    app.definitionView.model = definition;
    app.definitionView.model.wake(app.config.wakeful.url);
    app.definitionView.render();
  };


  app.photoOrVideo = function(url) {
    var type = null;

    var extension = app.parseExtension(url);
    if (extension === "jpg" || extension === "gif" || extension === "jpeg" || extension === "png") {
      type = "photo";
    } else if (extension === "mp4" || extension === "m4v" || extension === "mov") {
      type = "video";
    } else {
      type = "unknown";
    }

    return type;
  };

  app.parseExtension = function(url) {
    return url.substr(url.lastIndexOf('.') + 1).toLowerCase();
  };

  var idToTimestamp = function(id) {
    var timestamp = id.substring(0,8);
    var seconds = parseInt(timestamp, 16);
    return seconds;
  };

  app.convertStringArrayToIntArray = function(arr) {
    var result = arr.map(function (x) {
      return parseInt(x, 10);
    });
    return result;
  };

  var generateRandomClientId = function() {
    var length = 22;
    var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var result = '';
    for (var i = length; i > 0; --i) {
      result += chars[Math.round(Math.random() * (chars.length - 1))];
    }
    return result;
  };

  //*************** LOGIN FUNCTIONS ***************//

  app.loginUser = function (username) {
    // retrieve user with given username
    app.rollcall.user(username)
    .done(function (user) {
      if (user) {
        console.log(user.toJSON());

        app.username = user.get('username');
        app.currentUser = app.users.findWhere({username: app.username});

        jQuery.cookie('brainstorm_mobile_username', app.username, { expires: 1, path: '/' });
        jQuery('.username-display a').text(app.runId+"'s class - "+app.username);

        hideLogin();
        hideUserLoginPicker();
        showUsername();

        app.setup();
      } else {
        console.log('User '+username+' not found!');
        if (confirm('User '+username+' not found! Do you want to create the user to continue?')) {
            // Create user and continue!
            console.log('Create user and continue!');
        } else {
            // Do nothing!
            console.log('No user logged in!');
        }
      }
    });
  };

  var logoutUser = function () {
    jQuery.removeCookie('brainstorm_mobile_username',  { path: '/' });
    jQuery.removeCookie('brainstorm_mobile_runId',  { path: '/' });

    // to make reload not log us in again after logout is called we need to remove URL parameters
    if (window.location.search && window.location.search !== "") {
      var reloadUrl = window.location.origin + window.location.pathname;
      window.location.replace(reloadUrl);
    } else {
      window.location.reload();
    }
    return true;
  };

  var showLogin = function () {
    jQuery('#login-button').removeAttr('disabled');
    jQuery('#username').removeAttr('disabled');
  };

  var hideLogin = function () {
    jQuery('#login-button').attr('disabled','disabled');
    jQuery('#username').attr('disabled','disabled');
  };

  var hideUserLoginPicker = function () {
    // hide modal dialog
    jQuery('#login-picker').modal('hide');
  };

  var showUsername = function () {
    jQuery('.username-display').removeClass('hidden');
  };

  var hideUsername = function() {
    jQuery('.username-display').addClass('hidden');
  };

  var showRunPicker = function(runs) {
    jQuery('.login-buttons').html(''); //clear the house
    console.log(app.config.runs);

    // change header
    jQuery('#login-picker .modal-header h3').text("Select your teacher's name");

    _.each(app.config.runs, function(run) {
      var button = jQuery('<button class="btn btn-default btn-base login-button">');
      button.val(run);
      button.text(run);
      jQuery('.login-buttons').append(button);
    });

    // register click listeners
    jQuery('.login-button').click(function() {
      app.runId = jQuery(this).val();
      setDatabaseAndRollcallCollection();

      jQuery.cookie('brainstorm_mobile_runId', app.runId, { expires: 1, path: '/' });
      // jQuery('#login-picker').modal("hide");
      showUserLoginPicker(app.runId);
    });

    // show modal dialog
    jQuery('#login-picker').modal({keyboard: false, backdrop: 'static'});
  };

  var showUserLoginPicker = function(runId) {
    // change header
    jQuery('#login-picker .modal-header h3').text('Please login with your username');

    // retrieve all users that have runId
    // TODO: now that the users collection is within a run... why are the users being tagged with a run? Superfluous...
    app.rollcall.usersWithTags([runId])
    .done(function (availableUsers) {
      jQuery('.login-buttons').html(''); //clear the house
      app.users = availableUsers;

      if (app.users.length > 0) {
        // sort the collection by username
        app.users.comparator = function(model) {
          return model.get('display_name');
        };
        app.users.sort();

        app.users.each(function(user) {
          var button = jQuery('<button class="btn btn-default btn-base login-button">');
          button.val(user.get('username'));
          button.text(user.get('display_name'));
          jQuery('.login-buttons').append(button);
        });

        // register click listeners
        jQuery('.login-button').click(function() {
          var clickedUserName = jQuery(this).val();
          app.loginUser(clickedUserName);
        });
      } else {
        console.warn('Users collection is empty! Check database: '+DATABASE);
      }
    });
  };

  var setDatabaseAndRollcallCollection = function() {
    // set both of these globals. This function called from multiple places
    DATABASE = app.config.drowsy.db+'-'+app.runId;
    if (app.rollcall === null) {
      app.rollcall = new Rollcall(app.config.drowsy.url, DATABASE);
    }
  };

  // WARNING: 'runstate' is a bit misleading, since this does more than run state now - this might want to be multiple functions
  // takes an optional parameter ("new" or an object id), if not being used with
  // this desperately needs to be broken up into several functions
  app.reflectRunState = function() {
    // checking paused status
    if (app.runState.get('paused') === true) {
      console.log('Locking screen...');
      jQuery('#lock-screen').removeClass('hidden');
      jQuery('.user-screen').addClass('hidden');
    } else if (app.runState.get('paused') === false) {
      jQuery('#lock-screen').addClass('hidden');
      jQuery('#todo-screen').removeClass('hidden');
    }
  };

  app.hideAllContainers = function() {
    jQuery('.container-fluid').each(function (){
      jQuery(this).addClass('hidden');
    });
  };

  app.autoSave = function(model, inputKey, inputValue, instantSave, nested) {
    app.keyCount++;
    if (instantSave || app.keyCount > 20) {
      console.log('Autosaved...');
      // TODO: clean this out if nested isn't needed!
      if (nested === "proposal") {
        // think about using _.clone here (eg http://www.crittercism.com/blog/nested-attributes-in-backbone-js-models)
        var nestedObj = model.get(nested);
        nestedObj[inputKey] = inputValue;
        model.set(nested,nestedObj);
      } else {
        model.set(inputKey, inputValue);
      }
      model.save(null, {silent:true});
      app.keyCount = 0;
    }
  };

  app.clearAutoSaveTimer = function () {
    if (app.autoSaveTimer) {
      window.clearTimeout(app.autoSaveTimer);
    }
  };

  /**
    Function that is called on each keypress on username input field (in a form).
    If the 'return' key is pressed we call loginUser with the value of the input field.
    To avoid further bubbling, form submission and reload of page we have to return false.
    See also: http://stackoverflow.com/questions/905222/enter-key-press-event-in-javascript
  **/
  app.interceptKeypress = function(e) {
    if (e.which === 13 || e.keyCode === 13) {
      app.loginUser(jQuery('#username').val());
      return false;
    }
  };

  app.turnUrlsToLinks = function(text) {
    var urlRegex = /(https?:\/\/[^\s]+)/g;
    var urlText = text.replace(urlRegex, '<a href="$1">$1</a>');
    return urlText;
  };

  this.Skeletor = Skeletor;

}).call(this);