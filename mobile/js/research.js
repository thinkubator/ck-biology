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

  app.homeView = null;
  app.definitionView = null;
  app.relationshipView = null;
  app.vettingView = null;

  app.keyCount = 0;
  app.autoSaveTimer = window.setTimeout(function() { }, 10);

  app.state = [];

  app.numVettingTasks = [];


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
    .then(function() {
      Skeletor.Smartboard.init(app.runId);
    })
    .done(function () {
      ready();
      console.log('Models are awake - now calling ready...');
    });
  };

  var ready = function() {
    buildConstants();
    setUpUI();
    setUpClickListeners();
    wireUpViews();

    // decide on which screens to show/hide
    app.hideAllContainers();

    app.reflectRunState();
  };

  var buildConstants = function() {
    Skeletor.Model.awake.lessons.each(function(lesson) {
      app.numVettingTasks.push(lesson.get('vetting_tasks'));
    });
  };

  var setUpUI = function() {
    /* MISC */
    jQuery().toastmessage({
      position : 'middle-center'
    });

    jQuery('.brand').text("CK Biology 2016");

    jQuery('#tasks-completed-confirmation').dialog({ autoOpen: false });
  };

  var setUpClickListeners = function () {
    // click listener that logs user out
    jQuery('#logout-user').click(function() {
      logoutUser();
    });

    jQuery('.top-nav-btn').click(function() {
      if (app.username) {
        jQuery('.top-nav-btn').removeClass('hidden');
        jQuery('.top-nav-btn').removeClass('active');     // unmark all nav items
        // if the user is sitting on the confirm screen and hits home
        if (jQuery('#tasks-completed-confirmation').dialog('isOpen') === true) {
          jQuery('#tasks-completed-confirmation').dialog('close');
        }
        if (jQuery(this).hasClass('goto-home-btn')) {
          app.hideAllContainers();
          jQuery('.top-nav-btn').addClass('hidden');
          jQuery('#home-screen').removeClass('hidden');
          app.homeView.render();
        } else if (jQuery(this).hasClass('goto-contribution-btn')) {
          app.hideAllContainers();
          jQuery('#contribution-nav-btn').addClass('active');
          app.determineNextStep();
        } else if (jQuery(this).hasClass('goto-knowledge-base-btn')) {
          app.hideAllContainers();
          jQuery('#knowledge-base-nav-btn').addClass('active');
          //jQuery('#knowledge-base-screen').removeClass('hidden');
          jQuery('#wall').removeClass('hidden');
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

     if (app.homeView === null) {
       app.homeView = new app.View.HomeView({
         el: '#home-screen',
         collection: Skeletor.Model.awake.lessons
       });
     }

    if (app.definitionView === null) {
      app.definitionView = new app.View.DefinitionView({
        el: '#definition-screen',
        collection: Skeletor.Model.awake.terms
      });
    }

    if (app.relationshipView === null) {
      app.relationshipView = new app.View.RelationshipView({
        el: '#relationship-screen',
        collection: Skeletor.Model.awake.relationships
      });
    }

    if (app.vettingView === null) {
      app.vettingView = new app.View.VettingView({
        el: '#vetting-screen',
        collection: Skeletor.Model.awake.terms
      });
    }

    app.homeView.render();
  };


  //*************** HELPER FUNCTIONS ***************//

  app.buildContributionArray = function() {
    app.contributions = [];

    var sortedTerms = Skeletor.Model.awake.terms.clone();
    sortedTerms.comparator = function(model) {
      return model.get('name');
    };
    sortedTerms.sort();

    // get all terms, push those with app.lesson and assigned_to === app.username
    sortedTerms.each(function(term) {
      if (term.get('lesson') === app.lesson && term.get('assigned_to') === app.username && !term.get('complete')) {
        var obj = {};
        obj.kind = 'term';
        obj.content = term;
        app.contributions.push(obj);
      }
    });

    var sortedRelationships = Skeletor.Model.awake.relationships.clone();
    sortedRelationships.comparator = function(model) {
      return model.get('from');
    };
    sortedRelationships.sort();

    // get all relationships with app.lesson and assigned_to === app.username
    sortedRelationships.each(function(relationship) {
      if (relationship.get('lesson') === app.lesson && relationship.get('assigned_to') === app.username && !relationship.get('complete')) {
        var obj = {};
        obj.kind = 'relationship';
        obj.content = relationship;
        app.contributions.push(obj);
      }
    });

    var remainingVettings = getMyTotalVettings(app.lesson) - getMyCompleteVettings(app.lesson);     // can be negative
    for (var i = 0; i < remainingVettings; i++) {
      var obj = {};
      obj.kind = 'vetting';
      app.contributions.push(obj);
    }
  };

  app.determineNextStep = function() {
    console.log('Determining next step...');

    // if taskType is null, they are at 100%
    var taskType = null;
    if (app.nextContribution()) {
      taskType = app.nextContribution().kind;
    } else {
      taskType = "completed";
    }

    //0. it's complete
    //1. you didn't author that term
    //2. you haven't already vetted that term
    //3. it's in this lesson
    //4. it has the lowest number in terms of 'vetted count'. If tied, first alphabetically
    // we'll need to set a lock on the term so that nobody else can do it, so also
    //5. it is unlocked or locked to this user

    var myVettings = Skeletor.Model.awake.terms.filter(function(term) {
      return term.get('lesson') === app.lesson && term.get('complete') === true && term.get('assigned_to') !== app.username && !_.contains(term.get('vetted_by'), app.username) && (term.get('locked') === '' || term.get('locked') === app.username);
    });

    // To determine the least vetted item:
    // if myVettings.length > 0
    // loop i = 0
    // loop through myVettings
    // if vet.vetted_by.length == i, myVet = vet, break
    // if leastVetted.length > 0 then break
    // else i ++
    var leastVetted = [];
    if (myVettings.length > 0) {
      for (var i = 0; i < app.users.length; i++) {
        _.each(myVettings, function(vet) {
          if (vet.get('vetted_by').length == i) {
            leastVetted.push(vet);
          }
        });
        if (leastVetted.length > 0) {
          break;
        }
      }
    } else {
      console.log('No vettings available for you');
    }

    // check if there's a vet locked to this user:
    var myVet = null;
    _.each(leastVetted, function(vet) {
      if (vet.get('locked') === app.username) {
        myVet = vet;
      }
    });
    if (myVet === null) {
      myVet = _.first(leastVetted);
    }

    app.hideAllContainers();
    if (taskType === "term") {
      jQuery('#definition-screen').removeClass('hidden');
      var definition = app.nextContribution().content;
      app.definitionView.model = definition;
      app.definitionView.model.wake(app.config.wakeful.url);
      app.definitionView.render();

    } else if (taskType === "relationship") {
      jQuery('#relationship-screen').removeClass('hidden');
      var relationship = app.nextContribution().content;
      app.relationshipView.model = relationship;
      app.relationshipView.model.wake(app.config.wakeful.url);
      app.relationshipView.render();

    } else if (taskType === "vetting" && leastVetted.length > 0) {
      jQuery('#vetting-screen').removeClass('hidden');
      app.vettingView.model = myVet;
      app.vettingView.model.wake(app.config.wakeful.url);
      app.vettingView.model.set('locked', app.username);
      app.vettingView.model.save();
      app.vettingView.render();

    } else if (taskType === "vetting" && leastVetted.length <= 0) {
      jQuery().toastmessage('showWarningToast', "There are currently no terms for you to vet. Please return later after the community has provided more definitions");
      jQuery('.top-nav-btn').removeClass('active');
      jQuery('#home-nav-btn').addClass('active');
      jQuery('#home-screen').removeClass('hidden');
      app.homeView.render();

    } else if (taskType === "completed") {
      jQuery('#tasks-completed-confirmation').dialog({
        resizable: false,
        height: 'auto',
        width: 'auto',
        modal: true,
        dialogClass: 'no-close',
        autoOpen: true,
        buttons: {
          Yes: function() {
            jQuery(this).dialog('close');
            if (leastVetted.length > 0) {
              jQuery('#vetting-screen').removeClass('hidden');
              app.vettingView.model = myVet;
              app.vettingView.model.wake(app.config.wakeful.url);
              app.vettingView.model.set('locked', app.username);
              app.vettingView.model.save();
              app.vettingView.render();
            } else {
              jQuery().toastmessage('showWarningToast', "There are currently no terms for you to vet. Please return later after the community has provided more definitions");
              jQuery('.top-nav-btn').removeClass('active');
              jQuery('#home-nav-btn').addClass('active');
              jQuery('#home-screen').removeClass('hidden');
              app.homeView.render();
            }
          },
          No: function() {
            jQuery(this).dialog('close');
            jQuery('.top-nav-btn').addClass('hidden');
            jQuery('#home-screen').removeClass('hidden');
            app.homeView.render();
          }
        }
      });
    } else {
      jQuery().toastmessage('showErrorToast', "Something went wrong determining next step...");
    }
  }

  app.nextContribution = function() {
    return _.first(app.contributions);
  };

  app.markAsComplete = function() {
    app.contributions.shift();
    // bit of a hack, required to do the fact that the save() is async and the new model will be updated by wakeful to include the old media contributions
    if (app.contributions[0]) {
      if (app.contributions[0].kind === "term") {
        app.contributions[0].content.set('media', []);
      }
    }
  }

  app.getMyContributionPercent = function(lessonNum, noMax) {
    var myTotalTerms = Skeletor.Model.awake.terms.where({lesson: lessonNum, assigned_to: app.username}).length;
    var myCompleteTerms = Skeletor.Model.awake.terms.where({lesson: lessonNum, assigned_to: app.username, complete: true}).length;

    var myTotalRelationships = Skeletor.Model.awake.relationships.where({lesson: lessonNum, assigned_to: app.username}).length;
    var myCompleteRelationships = Skeletor.Model.awake.relationships.where({lesson: lessonNum, assigned_to: app.username, complete: true}).length;

    //console.log('My Totals: ' + myTotalTerms + ', ' + myTotalRelationships + ', ' + getMyTotalVettings(lessonNum));
    //console.log('My Completes: ' + myCompleteTerms + ', ' + myCompleteRelationships + ', ' + getMyCompleteVettings(lessonNum));

    var percent = (myCompleteTerms + myCompleteRelationships + getMyCompleteVettings(lessonNum)) / (myTotalTerms + myTotalRelationships + getMyTotalVettings(lessonNum)) * 100;

    if (!noMax && percent > 100) {
      percent = 100;
    }
    return Math.round(percent);
  };

  app.getCommunityContributionPercent = function(lessonNum) {
    var totalTerms = Skeletor.Model.awake.terms.where({lesson: lessonNum}).length;
    var completeTerms = Skeletor.Model.awake.terms.where({lesson: lessonNum, complete: true}).length;

    var totalRelationships = Skeletor.Model.awake.relationships.where({lesson: lessonNum}).length;
    var completeRelationships = Skeletor.Model.awake.relationships.where({lesson: lessonNum, complete: true}).length;

    var totalTerms = Skeletor.Model.awake.terms.where({lesson: lessonNum}).length;
    var totalStudents = app.users.where({user_role: "student"}).length;
    var totalVettings = totalTerms * app.numVettingTasks[lessonNum - 1];

    //console.log('Community Totals: ' + totalTerms + ', ' + totalRelationships + ', ' + totalVettings);
    //console.log('Community Completes: ' + completeTerms + ', ' + completeRelationships + ', ' + getCommunityCompleteVettings(lessonNum));

    var percent = (completeTerms + completeRelationships + getCommunityCompleteVettings(lessonNum)) / (totalTerms + totalRelationships + totalVettings) * 100;

    if (percent > 100) {
      percent = 100;
    }
    return Math.round(percent);
  };

  var getMyTotalVettings = function(lessonNum) {
    var totalTerms = Skeletor.Model.awake.terms.where({lesson: lessonNum}).length;
    var totalStudents = app.users.where({user_role: "student"}).length;
    return Math.ceil(totalTerms * app.numVettingTasks[lessonNum - 1] / totalStudents);        // round up
  };

  var getMyCompleteVettings = function(lessonNum) {
    var myCompletedVettings = _.filter(Skeletor.Model.awake.terms.where({lesson: lessonNum}), function(term) {
      return _.contains(term.get('vetted_by'), app.username);
    });
    return myCompletedVettings.length;
  };

  var getCommunityCompleteVettings = function(lessonNum) {
    var completedVettings = _.filter(Skeletor.Model.awake.terms.where({lesson: lessonNum}), function(term) {
      return term.get('vetted_by').length >= app.numVettingTasks[lessonNum - 1]
    });
    return completedVettings.length;
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
      var button = jQuery('<button class="btn btn-default login-button">');
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
          var button = jQuery('<button class="btn btn-default login-button">');
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
      jQuery('#home-screen').removeClass('hidden');
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
      model.set(inputKey, inputValue);
      model.set('modified_at', new Date());
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

  this.Skeletor = Skeletor;

}).call(this);
