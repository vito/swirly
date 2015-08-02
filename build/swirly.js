function GoroutineGroup(location) {
  this.location = location;
  this.goroutines = [];
  this.groups = {};
};

var packagePathRegex = /.*src\//
GoroutineGroup.prototype.packagePath = function() {
  return this.location.path.replace(packagePathRegex, "");
};

function GoroutineStack(id, state, waiting, isLocked) {
  this.id = id;
  this.state = state;
  this.waiting = waiting;
  this.isLocked = isLocked;
  this.stack = "";
};

GoroutineStack.prototype.pushStackLine = function(line) {
  this.stack += line + "\n";
};

var callArgRegex = /\(((0x[a-f0-9]+|\.\.\.)(, )?)+\)/;
var locationRegex = /\t([^\s]+) .*$/;

GoroutineStack.prototype.registerIn = function(group) {
  var stackLines = this.stack.split("\n");
  if (stackLines[stackLines.length - 1] == "") {
    stackLines.pop();
  }

  for (var i = stackLines.length - 2; i >= 0; i -= 2) {
    var call = stackLines[i];
    var path = stackLines[i+1];

    var pathMatch = path.match(locationRegex);

    var location = {
      call: call.replace(callArgRegex, "()"),
      path: pathMatch[1]
    }

    if (!group.groups[location.path]) {
      group.groups[location.path] = new GoroutineGroup(location);
    }

    group = group.groups[location.path];
  }

  group.goroutines.push(this);
};

GoroutineStack.prototype.waitInSeconds = function() {
  if (!this.waiting) {
    return 0;
  }

  var s = this.waiting.split(" ");
  var n = parseInt(s[0], 10);

  switch (s[1]) {
  case "hours":
    return n * 60 * 60;
  case "minutes": // only unit actually reported
    return n * 60;
  case "seconds":
    return n;
  default:
    console.log("unknown unit:", s[1]);
    return 0;
  }
};

var Goroutine = React.createClass({displayName: "Goroutine",
  render: function() {
    var classes = ["goroutine"];
    if (this.props.data.waiting) {
      classes.push("waiting");
    }

    return (
        React.createElement("div", {className: classes.join(" ")}, 
          React.createElement("div", {className: "id"}, "#", this.props.data.id), 
          React.createElement("div", {className: "status"}, this.props.data.state), 
          React.createElement("div", {className: "waiting"}, this.props.data.waiting), 
          React.createElement("pre", {className: "stack-trace"}, this.props.data.stack)
        )
    );
  }
});

var boringRegex = /src\/([a-z]+)\//;
var StackGroup = React.createClass({displayName: "StackGroup",
  getInitialState: function() {
    return {expanded: true};
  },

  handleToggle: function() {
    this.setState({expanded: !this.state.expanded});
  },

  render: function() {
    var subGroups = [];
    var goroutines = [];

    if (this.state.expanded) {
      for (var i in this.props.data.groups) {
        var group = this.props.data.groups[i];
        subGroups.push(React.createElement(StackGroup, {key: group.location.path, data: group}));
      }

      for (var i in this.props.data.goroutines) {
        var goroutine = this.props.data.goroutines[i];
        goroutines.push(React.createElement(Goroutine, {key: goroutine.id, data: goroutine}));
      }
    }

    if (this.props.data.location.path === undefined) {
      return (
          React.createElement("div", {className: "root-group"}, 
            subGroups
          )
      );
    }

    var classes = ["stack-group"];
    if (this.props.data.location.path.match(boringRegex)) {
      classes.push("boring");
    }

    return (
        React.createElement("div", {className: classes.join(" ")}, 
          React.createElement("div", {className: "title", onClick: this.handleToggle}, 
            React.createElement("h2", null, this.props.data.packagePath()), 
            React.createElement("h1", null, this.props.data.location.call)
          ), 
          React.createElement("div", {className: "stack-content"}, 
            goroutines, 
            subGroups
          )
        )
    );
  }
});

var Root = React.createClass({displayName: "Root",
  getInitialState: function() {
    return {filter: ""}
  },

  handleFilter: function(event) {
    this.setState({filter: event.target.value});
  },

  render: function() {
    var filteredGoroutines = [];
    for (var i in this.props.goroutines) {
      var goroutine = this.props.goroutines[i];
      if (goroutine.stack.indexOf(this.state.filter) == -1) {
        continue;
      }

      filteredGoroutines.push(goroutine);
    }

    var rootGroup = goroutineGroups(filteredGoroutines);

    return (
        React.createElement("div", {className: "swirly"}, 
          React.createElement("div", {className: "filter"}, 
            React.createElement("input", {type: "text", placeholder: "filter...", onChange: this.handleFilter})
          ), 

          React.createElement(StackGroup, {data: rootGroup})
        )
    );
  }
});

var goroutineHeaderRegex = /^goroutine (\d+) \[([^,\]]+)(, ([^,\]]+))?(, locked to thread)?\]:$/
function parseGoroutines(dumpLines) {
  var goroutines = [];

  var line;
  var goroutine;
  for (var i in dumpLines) {
    line = dumpLines[i];

    if (!goroutine) {
      var match = line.match(goroutineHeaderRegex);
      if (!match) {
        console.log("malformed goroutine stack header:", line);
        break;
      }

      goroutine = new GoroutineStack(match[1], match[2], match[4], !!match[5]);
      continue;
    } else if (line == "") {
      goroutines.push(goroutine);
      goroutine = undefined;
    } else {
      goroutine.pushStackLine(line);
    }
  }

  // handle last goroutine if no trailing linebreak
  if (goroutine) {
    goroutines.push(goroutine);
  }

  return goroutines;
}

function goroutineGroups(goroutines) {
  var rootGroup = new GoroutineGroup({});

  for (var i in goroutines) {
    goroutines[i].registerIn(rootGroup);
  }

  return rootGroup;
}

var atcExample;

function react() {
  var goroutines = parseGoroutines(atcExample.split("\n"));

  React.render(
    React.createElement(Root, {goroutines: goroutines}),
    document.getElementById('dumps')
  );
}

atcExample = "goroutine 774149 [running]:\n\
runtime/pprof.writeGoroutineStacks(0x7f259c972710, 0xc2092ce8c0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/runtime/pprof/pprof.go:511 +0x8d\n\
runtime/pprof.writeGoroutine(0x7f259c972710, 0xc2092ce8c0, 0x2, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/runtime/pprof/pprof.go:500 +0x4f\n\
runtime/pprof.(*Profile).WriteTo(0xc7dd00, 0x7f259c972710, 0xc2092ce8c0, 0x2, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/runtime/pprof/pprof.go:229 +0xd5\n\
net/http/pprof.handler.ServeHTTP(0xc2096e9841, 0x9, 0x7f259c96de70, 0xc2092ce8c0, 0xc20942e9c0)\n\
	/var/vcap/packages/golang/src/net/http/pprof/pprof.go:169 +0x35f\n\
net/http/pprof.Index(0x7f259c96de70, 0xc2092ce8c0, 0xc20942e9c0)\n\
	/var/vcap/packages/golang/src/net/http/pprof/pprof.go:181 +0x15e\n\
net/http.HandlerFunc.ServeHTTP(0xae1170, 0x7f259c96de70, 0xc2092ce8c0, 0xc20942e9c0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1265 +0x41\n\
net/http.(*ServeMux).ServeHTTP(0xc20803c720, 0x7f259c96de70, 0xc2092ce8c0, 0xc20942e9c0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1541 +0x17d\n\
net/http.serverHandler.ServeHTTP(0xc208047c20, 0x7f259c96de70, 0xc2092ce8c0, 0xc20942e9c0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1703 +0x19a\n\
net/http.(*conn).serve(0xc2092ce6e0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1204 +0xb57\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 1 [chan receive, 1308 minutes]:\n\
main.main()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/cmd/atc/main.go:452 +0x4310\n\
\n\
goroutine 5 [syscall, 1308 minutes]:\n\
os/signal.loop()\n\
	/var/vcap/packages/golang/src/os/signal/signal_unix.go:21 +0x1f\n\
created by os/signal.init·1\n\
	/var/vcap/packages/golang/src/os/signal/signal_unix.go:27 +0x35\n\
\n\
goroutine 6 [chan receive]:\n\
github.com/codahale/metrics.func·004()\n\
	/var/vcap/packages/atc/src/github.com/codahale/metrics/metrics.go:321 +0x80\n\
created by github.com/codahale/metrics.init·1\n\
	/var/vcap/packages/atc/src/github.com/codahale/metrics/metrics.go:328 +0x76\n\
\n\
goroutine 10 [chan receive, 1308 minutes]:\n\
database/sql.(*DB).connectionOpener(0xc208048460)\n\
	/var/vcap/packages/golang/src/database/sql/sql.go:589 +0x4c\n\
created by database/sql.Open\n\
	/var/vcap/packages/golang/src/database/sql/sql.go:452 +0x31c\n\
\n\
goroutine 9 [chan receive, 1308 minutes]:\n\
database/sql.(*DB).connectionOpener(0xc2080481e0)\n\
	/var/vcap/packages/golang/src/database/sql/sql.go:589 +0x4c\n\
created by database/sql.Open\n\
	/var/vcap/packages/golang/src/database/sql/sql.go:452 +0x31c\n\
\n\
goroutine 11 [chan receive, 3 minutes]:\n\
github.com/lib/pq.(*Listener).listenerConnLoop(0xc2080467e0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/notify.go:731 +0x1a1\n\
github.com/lib/pq.(*Listener).listenerMain(0xc2080467e0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/notify.go:750 +0x28\n\
created by github.com/lib/pq.NewListener\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/notify.go:422 +0x21d\n\
\n\
goroutine 12 [chan receive, 3 minutes]:\n\
github.com/concourse/atc/db.(*notificationsBus).dispatchNotifications(0xc20801f920)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb_bus.go:71 +0x58\n\
created by github.com/concourse/atc/db.NewNotificationsBus\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb_bus.go:23 +0xc9\n\
\n\
goroutine 27 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 26 [select, 1308 minutes]:\n\
github.com/tedsuo/ifrit/sigmon.sigmon.Run(0xc208183e40, 0x2, 0x2, 0x7f259c96dc90, 0xc2081a48a0, 0xc208046fc0, 0xc208047020, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/sigmon/sigmon.go:35 +0x30e\n\
github.com/tedsuo/ifrit/sigmon.(*sigmon).Run(0xc2081a48d0, 0xc208046fc0, 0xc208047020, 0x0, 0x0)\n\
	<autogenerated>:1 +0xc6\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a2800)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 28 [select, 1308 minutes]:\n\
reflect.Select(0xc208071b80, 0x6, 0x6, 0xc2080471a0, 0x0, 0x0, 0x0, 0x5)\n\
	/var/vcap/packages/golang/src/reflect/value.go:1965 +0x218\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).waitForSignal(0xc208164f30, 0xc2080471a0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:112 +0x499\n\
github.com/tedsuo/ifrit/grouper.parallelGroup.Run(0x7f259c966ba8, 0xc20802a190, 0xc2081a4870, 0xc2080486e0, 0x5, 0x5, 0xc2080471a0, 0xc208047200, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:45 +0x26a\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).Run(0xc2081a48a0, 0xc2080471a0, 0xc208047200, 0x0, 0x0)\n\
	<autogenerated>:31 +0xc6\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a2840)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 29 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 30 [select, 1308 minutes]:\n\
github.com/tedsuo/ifrit/http_server.(*httpServer).Run(0xc2081a2780, 0xc208047320, 0xc208047380, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/http_server/http_server.go:69 +0x612\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc208183ea0, 0xc208047320, 0xc208047380, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a29c0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 31 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 32 [select, 1308 minutes]:\n\
github.com/tedsuo/ifrit/http_server.(*httpServer).Run(0xc2081a27c0, 0xc2080474a0, 0xc208047500, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/http_server/http_server.go:69 +0x612\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc208183ee0, 0xc2080474a0, 0xc208047500, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a2a00)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 33 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 34 [chan receive, 1308 minutes]:\n\
main.func·003(0xc208047620, 0xc208047680, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/cmd/atc/main.go:423 +0x66\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc20818d2e0, 0xc208047620, 0xc208047680, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc208183f20, 0xc208047620, 0xc208047680, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a2a40)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 35 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 36 [select]:\n\
github.com/concourse/atc/pipelines.SyncRunner.Run(0x7f259c96dbc8, 0xc2081a2740, 0x2540be400, 0x7f259c96db88, 0xc91bf8, 0xc2080477a0, 0xc208047800, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/pipelines/sync_runner.go:30 +0x1ad\n\
github.com/concourse/atc/pipelines.(*SyncRunner).Run(0xc2081a4810, 0xc2080477a0, 0xc208047800, 0x0, 0x0)\n\
	<autogenerated>:7 +0xc6\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc208183f60, 0xc2080477a0, 0xc208047800, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a2a80)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 37 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 38 [select]:\n\
github.com/concourse/atc/builds.TrackerRunner.Run(0x7f259c96dbf0, 0xc2081a47e0, 0x2540be400, 0x7f259c96db88, 0xc91bf8, 0xc208047920, 0xc208047980, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/builds/tracker_runner.go:30 +0x1ad\n\
github.com/concourse/atc/builds.(*TrackerRunner).Run(0xc2081a4840, 0xc208047920, 0xc208047980, 0x0, 0x0)\n\
	<autogenerated>:4 +0xc6\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc208183fa0, 0xc208047920, 0xc208047980, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a2ac0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 39 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 40 [IO wait, 3 minutes]:\n\
net.(*pollDesc).Wait(0xc208198290, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208198290, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).accept(0xc208198230, 0x0, 0x7f259c96adf0, 0xc209252ee0)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:419 +0x40b\n\
net.(*TCPListener).AcceptTCP(0xc20803ac60, 0xc2081b0698, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/tcpsock_posix.go:234 +0x4e\n\
net.(*TCPListener).Accept(0xc20803ac60, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/tcpsock_posix.go:244 +0x4c\n\
net/http.(*Server).Serve(0xc208047b00, 0x7f259c96dd40, 0xc20803ac60, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1728 +0x92\n\
github.com/tedsuo/ifrit/http_server.func·002()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/http_server/http_server.go:63 +0x40\n\
created by github.com/tedsuo/ifrit/http_server.(*httpServer).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/http_server/http_server.go:64 +0x3d2\n\
\n\
goroutine 41 [IO wait]:\n\
net.(*pollDesc).Wait(0xc208198300, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208198300, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).accept(0xc2081982a0, 0x0, 0x7f259c96adf0, 0xc20869db40)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:419 +0x40b\n\
net.(*TCPListener).AcceptTCP(0xc20803ac78, 0xc2081b2e98, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/tcpsock_posix.go:234 +0x4e\n\
net.(*TCPListener).Accept(0xc20803ac78, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/tcpsock_posix.go:244 +0x4c\n\
net/http.(*Server).Serve(0xc208047c20, 0x7f259c96dd40, 0xc20803ac78, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1728 +0x92\n\
github.com/tedsuo/ifrit/http_server.func·002()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/http_server/http_server.go:63 +0x40\n\
created by github.com/tedsuo/ifrit/http_server.(*httpServer).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/http_server/http_server.go:64 +0x3d2\n\
\n\
goroutine 42 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 43 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 44 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 45 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 46 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 47 [chan receive, 1308 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 48 [IO wait, 3 minutes]:\n\
net.(*pollDesc).Wait(0xc208011480, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208011480, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208011420, 0xc2081bc000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20869d760)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20803ad20, 0xc2081bc000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2081ba060)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc2081ba060, 0xc20805eca0, 0x5, 0x200, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
io.ReadAtLeast(0x7f259c96cf40, 0xc2081ba060, 0xc20805eca0, 0x5, 0x200, 0x5, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:298 +0xf1\n\
io.ReadFull(0x7f259c96cf40, 0xc2081ba060, 0xc20805eca0, 0x5, 0x200, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:316 +0x6d\n\
github.com/lib/pq.(*conn).recvMessage(0xc20805ec80, 0xc2081b4960, 0xc208167f88, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:734 +0x17a\n\
github.com/lib/pq.(*ListenerConn).listenerConnLoop(0xc2081a3340, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/notify.go:132 +0x12f\n\
github.com/lib/pq.(*ListenerConn).listenerConnMain(0xc2081a3340)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/notify.go:178 +0x28\n\
created by github.com/lib/pq.NewListenerConn\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/notify.go:78 +0x1a6\n\
\n\
goroutine 50 [IO wait]:\n\
net.(*pollDesc).Wait(0xc208198610, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208198610, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2081985b0, 0xc2081bd000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208141730)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20803ad48, 0xc2081bd000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc208048cc8, 0xc2081bd000, 0x1000, 0x1000, 0x2, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc2081b4c80, 0xc2081bd000, 0x1000, 0x1000, 0x2, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc2081ba2a0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc2081ba2a0, 0xc20844fb0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc2081ba2a0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc209671a10, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc209671a10, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc2081ba2a0, 0xc2087c3110, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc208048c80, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc208048c80)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 51 [IO wait]:\n\
net.(*pollDesc).Wait(0xc208010680, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208010680, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208010620, 0xc208226000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208141678)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20803a078, 0xc208226000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc208048ae8, 0xc208226000, 0x1000, 0x1000, 0x2, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc2082225a0, 0xc208226000, 0x1000, 0x1000, 0x2, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc2081ba6c0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc2081ba6c0, 0xc20955db0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc2081ba6c0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc209288090, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc209288090, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc2081ba6c0, 0xc2087c3040, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc208048aa0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc208048aa0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 54 [IO wait]:\n\
net.(*pollDesc).Wait(0xc20829b6b0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20829b6b0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20829b650, 0xc2082c6000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20844a5f0)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20803a090, 0xc2082c6000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc2082db768, 0xc2082c6000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc208274e00, 0xc2082c6000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc208262180)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc208262180, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc208262180, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc2088719e0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc2088719e0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc208262180, 0xc2087c2410, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc2082db720, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc2082db720)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 159 [select, 1306 minutes]:\n\
reflect.Select(0xc2082a2bb0, 0x3, 0x3, 0xc2083b3620, 0x0, 0x0, 0x0, 0x2)\n\
	/var/vcap/packages/golang/src/reflect/value.go:1965 +0x218\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).waitForSignal(0xc2082eff30, 0xc2083b3620, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:112 +0x499\n\
github.com/tedsuo/ifrit/grouper.parallelGroup.Run(0x7f259c966ba8, 0xc20802a190, 0xc20837ed50, 0xc2081a39c0, 0x2, 0x2, 0xc2083b3620, 0xc2083b3680, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:45 +0x26a\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).Run(0xc20837ed80, 0xc2083b3620, 0xc2083b3680, 0x0, 0x0)\n\
	<autogenerated>:31 +0xc6\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a3a40)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 77087 [IO wait, 1168 minutes]:\n\
net.(*pollDesc).Wait(0xc20878a760, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20878a760, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20878a700, 0xc2092cc000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208737340)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e8c0, 0xc2092cc000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.noteEOFReader.Read(0x7f259c96cf18, 0xc20830e8c0, 0xc2082a3188, 0xc2092cc000, 0x1000, 0x1000, 0x7f259c959010, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1270 +0x6e\n\
net/http.(*noteEOFReader).Read(0xc2092de860, 0xc2092cc000, 0x1000, 0x1000, 0xc207fcf173, 0x0, 0x0)\n\
	<autogenerated>:125 +0xd4\n\
bufio.(*Reader).fill(0xc20833cb40)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Peek(0xc20833cb40, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:132 +0xf0\n\
net/http.(*persistConn).readLoop(0xc2082a3130)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:842 +0xa4\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:660 +0xc9f\n\
\n\
goroutine 163 [select]:\n\
github.com/concourse/atc/scheduler.(*Runner).Run(0xc2083e3f90, 0xc2083b3920, 0xc2083b3980, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/runner.go:61 +0x462\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc20830b360, 0xc2083b3920, 0xc2083b3980, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a3b40)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 160 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 164 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 63 [select, 1306 minutes]:\n\
reflect.Select(0xc2080c0580, 0x3, 0x3, 0xc2081ba4e0, 0x0, 0x0, 0x0, 0x2)\n\
	/var/vcap/packages/golang/src/reflect/value.go:1965 +0x218\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).waitForSignal(0xc2082f1f30, 0xc2081ba4e0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:112 +0x499\n\
github.com/tedsuo/ifrit/grouper.parallelGroup.Run(0x7f259c966ba8, 0xc20802a190, 0xc2083db710, 0xc20828b180, 0x2, 0x2, 0xc2081ba4e0, 0xc2081ba5a0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:45 +0x26a\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).Run(0xc2083db740, 0xc2081ba4e0, 0xc2081ba5a0, 0x0, 0x0)\n\
	<autogenerated>:31 +0xc6\n\
github.com/tedsuo/ifrit.(*process).run(0xc20828b200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 64 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 65 [select]:\n\
github.com/concourse/atc/radar.(*Runner).Run(0xc2081ba420, 0xc2081ba780, 0xc2081ba7e0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/runner.go:84 +0x62e\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082897a0, 0xc2081ba780, 0xc2081ba7e0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc20828b300)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 66 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 67 [select]:\n\
github.com/concourse/atc/scheduler.(*Runner).Run(0xc2082ac370, 0xc2081ba900, 0xc2081ba960, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/runner.go:61 +0x462\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082897e0, 0xc2081ba900, 0xc2081ba960, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc20828b380)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 68 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 69 [select, 729 minutes]:\n\
github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run(0xc2082ac4b0, 0xc2081bade0, 0xc2081bae40, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:67 +0xab7\n\
github.com/tedsuo/ifrit.(*process).run(0xc20828b680)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 70 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 71 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 72 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 73 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 73128 [IO wait, 1169 minutes]:\n\
net.(*pollDesc).Wait(0xc20829b790, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20829b790, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20829b730, 0xc2081d7000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2084364f8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b56260, 0xc2081d7000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc20873dd40)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc20873dd40, 0x7f259c994190, 0xc20857a510, 0x7ff8, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:449 +0x27e\n\
io.Copy(0x7f259c994190, 0xc20857a510, 0x7f259c96cf40, 0xc20873dd40, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 99 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 773010 [semacquire, 2 minutes]:\n\
sync.(*Cond).Wait(0xc209229c40)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*process).Wait(0xc209229cc0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/process.go:35 +0x7f\n\
github.com/concourse/atc/worker.(*retryableProcess).Wait(0xc2091614a0, 0x4, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:425 +0x5f\n\
github.com/concourse/atc/exec.func·004()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/task_step.go:168 +0x5f\n\
created by github.com/concourse/atc/exec.(*taskStep).Run\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/task_step.go:174 +0x808\n\
\n\
goroutine 411719 [chan receive, 729 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 31171 [chan receive, 1238 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2082219c0, 0x18, 0x7f259c96dc18, 0xc208221a20, 0x7f259c96dce0, 0xc2084ac800, 0xc2081bb1a0, 0xc2081bb200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 77037 [chan receive, 1168 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 87 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc2082620c0, 0xc208262120, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2082b5f60, 0xc2082620c0, 0xc208262120, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2083c4240, 0xc2082620c0, 0xc208262120, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2082054c0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 88 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc208204f80, 0x32, 0x7f259c96dc18, 0xc2082b5f60, 0x7f259c96dce0, 0xc2082054c0, 0xc2081bb1a0, 0xc2081bb200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 50850 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 76782 [select, 1153 minutes]:\n\
github.com/concourse/atc/engine.(*execBuild).Resume(0xc2080ca090, 0x7f259c96bc08, 0xc20841e060)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/engine/exec_engine.go:113 +0x7cc\n\
github.com/concourse/atc/engine.(*dbBuild).Resume(0xc20853cb00, 0x7f259c96bc08, 0xc20841e060)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/engine/db_engine.go:232 +0xbdc\n\
github.com/concourse/atc/scheduler.func·002()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:180 +0x13e\n\
created by github.com/concourse/atc/scheduler.(*Scheduler).TriggerImmediately\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:182 +0x430\n\
\n\
goroutine 38146 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 54179 [IO wait, 1169 minutes]:\n\
net.(*pollDesc).Wait(0xc2084d9c60, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc2084d9c60, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2084d9c00, 0xc20800f000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20823bb28)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e6e0, 0xc20800f000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2082a5b60)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc2082a5b60, 0x7f259c994190, 0xc2080ca2d0, 0x5d3b9, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:449 +0x27e\n\
io.Copy(0x7f259c994190, 0xc2080ca2d0, 0x7f259c96cf40, 0xc2082a5b60, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 33738 [chan receive, 1232 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 77034 [chan receive, 1168 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 770446 [IO wait]:\n\
net.(*pollDesc).Wait(0xc20966faa0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20966faa0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20966fa40, 0xc208692000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20869d040)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e148, 0xc208692000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc2086909a8, 0xc208692000, 0x1000, 0x1000, 0xc00000000000000, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc2092dea80, 0xc208692000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc209250f60)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc209250f60, 0xa, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc209250f60, 0x0, 0x0, 0x0, 0xc207e91600, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc2096e9620, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc2096e9620, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc209250f60, 0xc20942e820, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc208690960, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc208690960)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 31179 [chan receive, 1238 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 73134 [semacquire, 1173 minutes]:\n\
sync.(*Cond).Wait(0xc208427b40)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*process).Wait(0xc208427c00, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/process.go:35 +0x7f\n\
github.com/concourse/atc/worker.(*retryableProcess).Wait(0xc2081d8200, 0x4, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:425 +0x5f\n\
github.com/concourse/atc/exec.func·004()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/task_step.go:168 +0x5f\n\
created by github.com/concourse/atc/exec.(*taskStep).Run\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/task_step.go:174 +0x808\n\
\n\
goroutine 105 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50870 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50851 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 31170 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc208282e40, 0xc208282ea0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc208221a20, 0xc208282e40, 0xc208282ea0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc208221ac0, 0xc208282e40, 0xc208282ea0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2084ac800)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 77088 [select, 1168 minutes]:\n\
net/http.(*persistConn).writeLoop(0xc2082a3130)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:945 +0x41d\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:661 +0xcbc\n\
\n\
goroutine 166 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 169 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 73634 [semacquire, 1169 minutes]:\n\
sync.(*Cond).Wait(0xc2082d7470)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
io.(*pipe).read(0xc2082d7440, 0xc2092f6000, 0x8000, 0x8000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:52 +0x303\n\
io.(*PipeReader).Read(0xc20830e4c0, 0xc2092f6000, 0x8000, 0x8000, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:134 +0x5b\n\
io.Copy(0x7f259c984630, 0xc20843b680, 0x7f259c982be0, 0xc20830e4c0, 0x51, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:362 +0x1f6\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·004(0x7f259c984600, 0xc20843b680, 0x7f259c982be0, 0xc20830e4c0, 0x7f259c96bc08, 0xc208282600)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:34 +0x6a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamIn\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:39 +0x75\n\
\n\
goroutine 165 [select, 1221 minutes]:\n\
github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run(0xc2082f6140, 0xc2083b3e00, 0xc2083b3e60, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:67 +0xab7\n\
github.com/tedsuo/ifrit.(*process).run(0xc20818af00)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 168 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 167 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50873 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 77219 [chan receive, 1168 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 161 [select]:\n\
github.com/concourse/atc/radar.(*Runner).Run(0xc2083b3560, 0xc2083b37a0, 0xc2083b3800, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/runner.go:84 +0x62e\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc20830b320, 0xc2083b37a0, 0xc2083b3800, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2081a3a80)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 38152 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50844 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 162 [chan receive, 1306 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50849 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50874 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 77033 [select, 1168 minutes]:\n\
github.com/concourse/atc/exec.aggregateStep.Run(0xc2084b3760, 0x2, 0x2, 0xc2085465a0, 0xc208546600, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/aggregate.go:34 +0xb73\n\
github.com/concourse/atc/exec.(*aggregateStep).Run(0xc2084b3780, 0xc2085465a0, 0xc208546600, 0x0, 0x0)\n\
	<autogenerated>:4 +0xc7\n\
github.com/concourse/atc/exec.(*hookedCompose).Run(0xc2082d66c0, 0xc2085465a0, 0xc208546600, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/hooked_compose_step.go:53 +0x11f\n\
github.com/tedsuo/ifrit.(*process).run(0xc2083984c0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 50879 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 73108 [semacquire, 1173 minutes]:\n\
sync.(*Cond).Wait(0xc2088581b0)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
io.(*pipe).read(0xc208858180, 0xc208848000, 0x8000, 0x8000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:52 +0x303\n\
io.(*PipeReader).Read(0xc208b568b8, 0xc208848000, 0x8000, 0x8000, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:134 +0x5b\n\
io.Copy(0x7f259c984630, 0xc208275ee0, 0x7f259c982be0, 0xc208b568b8, 0x1c, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:362 +0x1f6\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·004(0x7f259c984600, 0xc208275ee0, 0x7f259c982be0, 0xc208b568b8, 0x7f259c96bc08, 0xc208406ea0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:34 +0x6a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamIn\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:39 +0x75\n\
\n\
goroutine 50848 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 38138 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2084dcd80, 0x2e, 0x7f259c96dc18, 0xc2084b7b20, 0x7f259c96dce0, 0xc2083995c0, 0xc2081bb1a0, 0xc2081bb200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 50858 [select, 1166 minutes]:\n\
net/http.(*persistConn).roundTrip(0xc2082a2fd0, 0xc2092cbc10, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1082 +0x7ad\n\
net/http.(*Transport).RoundTrip(0xc20857a360, 0xc208599ad0, 0xc208b60b60, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:235 +0x558\n\
net/http.send(0xc208599ad0, 0x7f259c96afc0, 0xc20857a360, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:219 +0x4fc\n\
net/http.(*Client).send(0xc2092882a0, 0xc208599ad0, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:142 +0x15b\n\
net/http.(*Client).doFollowingRedirects(0xc2092882a0, 0xc208599ad0, 0xae1150, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:367 +0xb25\n\
net/http.(*Client).Do(0xc2092882a0, 0xc208599ad0, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:177 +0x192\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*hijackable).Stream(0xc208b606a0, 0x99cb90, 0x6, 0x7f259c9842e0, 0xc208753490, 0x0, 0x0, 0x9ff110, 0x10, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection_hijacker.go:97 +0x1cb\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).do(0xc208b606c0, 0x99cb90, 0x6, 0x960c60, 0xc2082f4480, 0x7fb720, 0xc2092cba70, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:636 +0x1ea\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).Create(0xc208b606c0, 0x0, 0x0, 0x0, 0xc2084ff980, 0x1f, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:126 +0x12c\n\
github.com/concourse/atc/worker.func·007(0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:121 +0x94\n\
github.com/concourse/atc/worker.(*RetryableConnection).retry(0xc20964d500, 0xc2087c71b0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:362 +0x105\n\
github.com/concourse/atc/worker.RetryableConnection.Create(0x7f259c983d38, 0xc208b606c0, 0x7f259c96bc08, 0xc2093027e0, 0x7f259c983e38, 0xc91bf8, 0x7f259c983e60, 0xc2092cb538, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:123 +0xe5\n\
github.com/concourse/atc/worker.(*RetryableConnection).Create(0xc20964d2c0, 0x0, 0x0, 0x0, 0xc2084ff980, 0x1f, 0x0, 0x0, 0x0, 0x0, ...)\n\
	<autogenerated>:50 +0xf9\n\
github.com/cloudfoundry-incubator/garden/client.(*client).Create(0xc2092cb590, 0x0, 0x0, 0x0, 0xc2084ff980, 0x1f, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/client.go:31 +0x9d\n\
github.com/concourse/atc/worker.(*gardenWorker).CreateContainer(0xc208753030, 0xc208479600, 0xc, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc20847960c, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:96 +0x335\n\
github.com/concourse/atc/worker.(*Pool).CreateContainer(0xc20801fa80, 0xc208479600, 0xc, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc20847960c, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/pool.go:76 +0x4c8\n\
github.com/concourse/atc/resource.(*tracker).Init(0xc208150290, 0xc208479600, 0xc, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc20847960c, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/tracker.go:46 +0x425\n\
github.com/concourse/atc/radar.(*Radar).scan(0xc2083e2690, 0x7f259c96bc08, 0xc2084073e0, 0xc2083774b0, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:148 +0x66d\n\
github.com/concourse/atc/radar.func·001(0xc208287860, 0xc2082878c0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:88 +0x3ce\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2082f8a00, 0xc208287860, 0xc2082878c0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082f8c20, 0xc208287860, 0xc2082878c0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2087741c0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 33737 [chan receive, 1232 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 326602 [IO wait]:\n\
net.(*pollDesc).Wait(0xc208828140, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208828140, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2088280e0, 0xc2083d8000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2087fe4e0)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b56130, 0xc2083d8000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc2092cfa88, 0xc2083d8000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc2092de3e0, 0xc2083d8000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc208547bc0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc208547bc0, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc208547bc0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc20828e000, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc20828e000, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc208547bc0, 0xc20942edd0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc2092cfa40, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc2092cfa40)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 50868 [select, 1166 minutes]:\n\
net/http.(*persistConn).roundTrip(0xc2080c1290, 0xc208740670, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1082 +0x7ad\n\
net/http.(*Transport).RoundTrip(0xc20857b830, 0xc2084a3110, 0xc208594d20, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:235 +0x558\n\
net/http.send(0xc2084a3110, 0x7f259c96afc0, 0xc20857b830, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:219 +0x4fc\n\
net/http.(*Client).send(0xc208428b70, 0xc2084a3110, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:142 +0x15b\n\
net/http.(*Client).doFollowingRedirects(0xc208428b70, 0xc2084a3110, 0xae1150, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:367 +0xb25\n\
net/http.(*Client).Do(0xc208428b70, 0xc2084a3110, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:177 +0x192\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*hijackable).Stream(0xc208594800, 0x99cb90, 0x6, 0x7f259c9842e0, 0xc2092f58f0, 0x0, 0x0, 0x9ff110, 0x10, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection_hijacker.go:97 +0x1cb\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).do(0xc208594840, 0x99cb90, 0x6, 0x960c60, 0xc208824680, 0x7fb720, 0xc208740530, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:636 +0x1ea\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).Create(0xc208594840, 0x0, 0x0, 0x0, 0xc2082f9a80, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:126 +0x12c\n\
github.com/concourse/atc/worker.func·007(0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:121 +0x94\n\
github.com/concourse/atc/worker.(*RetryableConnection).retry(0xc2092e1c00, 0xc20849b1b0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:362 +0x105\n\
github.com/concourse/atc/worker.RetryableConnection.Create(0x7f259c983d38, 0xc208594840, 0x7f259c96bc08, 0xc208283380, 0x7f259c983e38, 0xc91bf8, 0x7f259c983e60, 0xc208479ff8, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:123 +0xe5\n\
github.com/concourse/atc/worker.(*RetryableConnection).Create(0xc2092e1a80, 0x0, 0x0, 0x0, 0xc2082f9a80, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	<autogenerated>:50 +0xf9\n\
github.com/cloudfoundry-incubator/garden/client.(*client).Create(0xc208740050, 0x0, 0x0, 0x0, 0xc2082f9a80, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/client.go:31 +0x9d\n\
github.com/concourse/atc/worker.(*gardenWorker).CreateContainer(0xc2092f5650, 0xc2083686f0, 0x23, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc20881da46, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:96 +0x335\n\
github.com/concourse/atc/worker.(*Pool).CreateContainer(0xc20801fa80, 0xc2083686f0, 0x23, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc20881da46, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/pool.go:76 +0x4c8\n\
github.com/concourse/atc/resource.(*tracker).Init(0xc208150290, 0xc2083686f0, 0x23, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc20881da46, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/tracker.go:46 +0x425\n\
github.com/concourse/atc/radar.(*Radar).scan(0xc2083e2690, 0x7f259c96bc08, 0xc209302060, 0xc2082dfec0, 0x23, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:148 +0x66d\n\
github.com/concourse/atc/radar.func·001(0xc208287ec0, 0xc208287f20, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:88 +0x3ce\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2082f8be0, 0xc208287ec0, 0xc208287f20, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082f8cc0, 0xc208287ec0, 0xc208287f20, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208774140)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 54184 [semacquire, 1195 minutes]:\n\
sync.(*Cond).Wait(0xc208867d00)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*process).Wait(0xc208867d40, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/process.go:35 +0x7f\n\
github.com/concourse/atc/worker.(*retryableProcess).Wait(0xc208776700, 0x4, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:425 +0x5f\n\
github.com/concourse/atc/resource.func·003()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/run_script.go:134 +0x4b\n\
created by github.com/concourse/atc/resource.func·004\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/run_script.go:140 +0x84c\n\
\n\
goroutine 773004 [IO wait]:\n\
net.(*pollDesc).Wait(0xc2087531e0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc2087531e0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208753180, 0xc2084fc000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20869daa8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e288, 0xc2084fc000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc208571260)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc208571260, 0x7f259c994190, 0xc2080ca870, 0x10463, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:449 +0x27e\n\
io.Copy(0x7f259c994190, 0xc2080ca870, 0x7f259c96cf40, 0xc208571260, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 77138 [IO wait, 1168 minutes]:\n\
net.(*pollDesc).Wait(0xc20879de20, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20879de20, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20879ddc0, 0xc208834000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208437630)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e488, 0xc208834000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc208407ce0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc208407ce0, 0xc2092dd801, 0x5ff, 0x5ff, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
encoding/json.(*Decoder).readValue(0xc20842cc00, 0xc207e9b2c3, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:124 +0x5e1\n\
encoding/json.(*Decoder).Decode(0xc20842cc00, 0x7ea140, 0xc20964d3c0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:44 +0x7b\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).wait(0xc209160b20, 0xc20842cc00, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:53 +0x97\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·002()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:278 +0x125\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*connection).streamProcess\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:280 +0xc9c\n\
\n\
goroutine 38289 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 773011 [chan receive, 2 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50875 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 38142 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2083992c0, 0x31, 0x7f259c96dc18, 0xc2084b7c20, 0x7f259c96dce0, 0xc208399640, 0xc2081bb1a0, 0xc2081bb200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 50878 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 78581 [IO wait, 1166 minutes]:\n\
net.(*pollDesc).Wait(0xc208753790, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208753790, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208753730, 0xc2092d2000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2092cbcf0)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e5b0, 0xc2092d2000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.noteEOFReader.Read(0x7f259c96cf18, 0xc20830e5b0, 0xc2082a3028, 0xc2092d2000, 0x1000, 0x1000, 0x7f259c959010, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1270 +0x6e\n\
net/http.(*noteEOFReader).Read(0xc208b60c20, 0xc2092d2000, 0x1000, 0x1000, 0xc207fcf1a3, 0x0, 0x0)\n\
	<autogenerated>:125 +0xd4\n\
bufio.(*Reader).fill(0xc209303860)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Peek(0xc209303860, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:132 +0xf0\n\
net/http.(*persistConn).readLoop(0xc2082a2fd0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:842 +0xa4\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:660 +0xc9f\n\
\n\
goroutine 50843 [select]:\n\
github.com/concourse/atc/radar.(*Runner).Run(0xc208286420, 0xc2082866c0, 0xc208286720, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/runner.go:84 +0x62e\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc208288980, 0xc2082866c0, 0xc208286720, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208334a40)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 50841 [select, 1198 minutes]:\n\
reflect.Select(0xc2080c0630, 0x3, 0x3, 0xc2082864e0, 0x0, 0x0, 0x0, 0x2)\n\
	/var/vcap/packages/golang/src/reflect/value.go:1965 +0x218\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).waitForSignal(0xc208756f30, 0xc2082864e0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:112 +0x499\n\
github.com/tedsuo/ifrit/grouper.parallelGroup.Run(0x7f259c966ba8, 0xc20802a190, 0xc2087f9020, 0xc208334900, 0x2, 0x2, 0xc2082864e0, 0xc208286540, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/parallel.go:45 +0x26a\n\
github.com/tedsuo/ifrit/grouper.(*parallelGroup).Run(0xc2087f9050, 0xc2082864e0, 0xc208286540, 0x0, 0x0)\n\
	<autogenerated>:31 +0xc6\n\
github.com/tedsuo/ifrit.(*process).run(0xc208334980)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 50871 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 77216 [select, 1167 minutes]:\n\
net/http.(*persistConn).roundTrip(0xc208395ef0, 0xc208731be0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1082 +0x7ad\n\
net/http.(*Transport).RoundTrip(0xc2080cbcb0, 0xc2085991e0, 0xc2084d7220, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:235 +0x558\n\
net/http.send(0xc2085991e0, 0x7f259c96afc0, 0xc2080cbcb0, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:219 +0x4fc\n\
net/http.(*Client).send(0xc2084f5ec0, 0xc2085991e0, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:142 +0x15b\n\
net/http.(*Client).doFollowingRedirects(0xc2084f5ec0, 0xc2085991e0, 0xae1150, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:367 +0xb25\n\
net/http.(*Client).Do(0xc2084f5ec0, 0xc2085991e0, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:177 +0x192\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*hijackable).Stream(0xc2084d6fa0, 0x99cb90, 0x6, 0x7f259c9842e0, 0xc2087530a0, 0x0, 0x0, 0x9ff110, 0x10, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection_hijacker.go:97 +0x1cb\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).do(0xc2084d6fc0, 0x99cb90, 0x6, 0x960c60, 0xc20819aa80, 0x7fb720, 0xc208731a10, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:636 +0x1ea\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).Create(0xc2084d6fc0, 0x0, 0x0, 0x0, 0xc2084f54a0, 0x28, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:126 +0x12c\n\
github.com/concourse/atc/worker.func·007(0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:121 +0x94\n\
github.com/concourse/atc/worker.(*RetryableConnection).retry(0xc209246d40, 0xc20858f1b0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:362 +0x105\n\
github.com/concourse/atc/worker.RetryableConnection.Create(0x7f259c983d38, 0xc2084d6fc0, 0x7f259c96bc08, 0xc208283bc0, 0x7f259c983e38, 0xc91bf8, 0x7f259c983e60, 0xc2087318a0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:123 +0xe5\n\
github.com/concourse/atc/worker.(*RetryableConnection).Create(0xc209246cc0, 0x0, 0x0, 0x0, 0xc2084f54a0, 0x28, 0x0, 0x0, 0x0, 0x0, ...)\n\
	<autogenerated>:50 +0xf9\n\
github.com/cloudfoundry-incubator/garden/client.(*client).Create(0xc2087318b0, 0x0, 0x0, 0x0, 0xc2084f54a0, 0x28, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/client.go:31 +0x9d\n\
github.com/concourse/atc/worker.(*gardenWorker).CreateContainer(0xc208752fc0, 0xc2083a15c0, 0x22, 0xc20818dce0, 0xd, 0x0, 0x9a94d0, 0x5, 0x0, 0xc208478390, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:96 +0x335\n\
github.com/concourse/atc/worker.(*Pool).CreateContainer(0xc20801fa80, 0xc2083a15c0, 0x22, 0xc20818dce0, 0xd, 0x0, 0x9a94d0, 0x5, 0x0, 0xc208478390, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/pool.go:76 +0x4c8\n\
github.com/concourse/atc/resource.(*tracker).Init(0xc208150290, 0xc2083a15c0, 0x22, 0xc20818dce0, 0xd, 0x0, 0x9a94d0, 0x5, 0x0, 0xc208478390, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/tracker.go:46 +0x425\n\
github.com/concourse/atc/radar.(*Radar).scan(0xc2082ac1e0, 0x7f259c96bc08, 0xc2092bb3e0, 0xc2092a6de0, 0x22, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:148 +0x66d\n\
github.com/concourse/atc/radar.func·001(0xc20833db00, 0xc20833db60, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:88 +0x3ce\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2082f9480, 0xc20833db00, 0xc20833db60, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082f94e0, 0xc20833db00, 0xc20833db60, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2092e0240)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 50845 [semacquire, 987 minutes]:\n\
sync.(*WaitGroup).Wait(0xc2085c89a0)\n\
	/var/vcap/packages/golang/src/sync/waitgroup.go:132 +0x169\n\
github.com/concourse/atc/scheduler.(*Runner).schedule(0xc2083e2780, 0x7f259c96bc08, 0xc209734120, 0xc2081405c0, 0xd, 0x100, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/runner.go:110 +0xe2\n\
github.com/concourse/atc/scheduler.(*Runner).tick(0xc2083e2780, 0x7f259c96bc08, 0xc208721260, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/runner.go:101 +0x6e4\n\
github.com/concourse/atc/scheduler.(*Runner).Run(0xc2083e2780, 0xc208286840, 0xc2082868a0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/runner.go:56 +0x340\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082889e0, 0xc208286840, 0xc2082868a0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208334a80)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 38150 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 33736 [chan receive, 1232 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2087f9d40, 0x29, 0x7f259c96dc18, 0xc2083fb9e0, 0x7f259c96dce0, 0xc2082b1280, 0xc2083ee420, 0xc2083ee480)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 50862 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc208287b60, 0xc208287bc0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2082f8ac0, 0xc208287b60, 0xc208287bc0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082f8c60, 0xc208287b60, 0xc208287bc0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208774080)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 31176 [chan receive, 1238 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 54178 [IO wait, 1195 minutes]:\n\
net.(*pollDesc).Wait(0xc2084d98e0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc2084d98e0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2084d9880, 0xc20819d400, 0x200, 0x200, 0x0, 0x7f259c96adf0, 0xc2082fdf88)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e6d0, 0xc20819d400, 0x200, 0x200, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bytes.(*Buffer).ReadFrom(0xc2084d8460, 0x7f259c96cf18, 0xc20830e6d0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bytes/buffer.go:169 +0x25a\n\
bufio.(*Reader).WriteTo(0xc2082a5aa0, 0x7f259c96dea8, 0xc2084d8460, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:433 +0x194\n\
io.Copy(0x7f259c96dea8, 0xc2084d8460, 0x7f259c96cf40, 0xc2082a5aa0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 38141 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc208282cc0, 0xc208282d20, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2084b7c20, 0xc208282cc0, 0xc208282d20, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2084b7d40, 0xc208282cc0, 0xc208282d20, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208399640)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 78607 [IO wait, 1166 minutes]:\n\
net.(*pollDesc).Wait(0xc2092f5b80, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc2092f5b80, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2092f5b20, 0xc2083ec000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208740740)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830eaa0, 0xc2083ec000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.noteEOFReader.Read(0x7f259c96cf18, 0xc20830eaa0, 0xc2080c12e8, 0xc2083ec000, 0x1000, 0x1000, 0x7f259c959010, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1270 +0x6e\n\
net/http.(*noteEOFReader).Read(0xc208594e20, 0xc2083ec000, 0x1000, 0x1000, 0xc207fcf155, 0x0, 0x0)\n\
	<autogenerated>:125 +0xd4\n\
bufio.(*Reader).fill(0xc2083a8720)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Peek(0xc2083a8720, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:132 +0xf0\n\
net/http.(*persistConn).readLoop(0xc2080c1290)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:842 +0xa4\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:660 +0xc9f\n\
\n\
goroutine 38144 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50842 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 77136 [IO wait, 1168 minutes]:\n\
net.(*pollDesc).Wait(0xc208752060, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208752060, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208752000, 0xc20819d800, 0x200, 0x200, 0x0, 0x7f259c96adf0, 0xc208437478)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e528, 0xc20819d800, 0x200, 0x200, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bytes.(*Buffer).ReadFrom(0xc20879d730, 0x7f259c96cf18, 0xc20830e528, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bytes/buffer.go:169 +0x25a\n\
bufio.(*Reader).WriteTo(0xc208407d40, 0x7f259c96dea8, 0xc20879d730, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:433 +0x194\n\
io.Copy(0x7f259c96dea8, 0xc20879d730, 0x7f259c96cf40, 0xc208407d40, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 38290 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50866 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc208287da0, 0xc208287e00, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2082f8b80, 0xc208287da0, 0xc208287e00, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082f8ca0, 0xc208287da0, 0xc208287e00, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208774100)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 77036 [select, 1168 minutes]:\n\
net/http.(*persistConn).roundTrip(0xc2082a3130, 0xc208737260, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1082 +0x7ad\n\
net/http.(*Transport).RoundTrip(0xc2084d46c0, 0xc208598c30, 0xc2092de6c0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:235 +0x558\n\
net/http.send(0xc208598c30, 0x7f259c96afc0, 0xc2084d46c0, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:219 +0x4fc\n\
net/http.(*Client).send(0xc208806720, 0xc208598c30, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:142 +0x15b\n\
net/http.(*Client).doFollowingRedirects(0xc208806720, 0xc208598c30, 0xae1150, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:367 +0xb25\n\
net/http.(*Client).Do(0xc208806720, 0xc208598c30, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:177 +0x192\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*hijackable).Stream(0xc2092de440, 0x99cb90, 0x6, 0x7f259c9842e0, 0xc20878a4d0, 0x0, 0x0, 0x9ff110, 0x10, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection_hijacker.go:97 +0x1cb\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).do(0xc2092de460, 0x99cb90, 0x6, 0x960c60, 0xc2087d1700, 0x7fb720, 0xc208737150, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:636 +0x1ea\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).Create(0xc2092de460, 0x0, 0x0, 0x0, 0xc2083bbd00, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:126 +0x12c\n\
github.com/concourse/atc/worker.func·007(0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:121 +0x94\n\
github.com/concourse/atc/worker.(*RetryableConnection).retry(0xc208866840, 0xc2084f9588, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:362 +0x105\n\
github.com/concourse/atc/worker.RetryableConnection.Create(0x7f259c983d38, 0xc2092de460, 0x7f259c96bc08, 0xc20873de60, 0x7f259c983e38, 0xc91bf8, 0x7f259c983e60, 0xc208736f30, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:123 +0xe5\n\
github.com/concourse/atc/worker.(*RetryableConnection).Create(0xc208866780, 0x0, 0x0, 0x0, 0xc2083bbd00, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	<autogenerated>:50 +0xf9\n\
github.com/cloudfoundry-incubator/garden/client.(*client).Create(0xc208736f40, 0x0, 0x0, 0x0, 0xc2083bbd00, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/client.go:31 +0x9d\n\
github.com/concourse/atc/worker.(*gardenWorker).CreateContainer(0xc20878a380, 0xc2084b2e40, 0x1c, 0x0, 0x0, 0x6f6, 0x9ad610, 0x3, 0x3, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:96 +0x335\n\
github.com/concourse/atc/worker.(*Pool).CreateContainer(0xc20801fa80, 0xc2084b2e40, 0x1c, 0x0, 0x0, 0x6f6, 0x9ad610, 0x3, 0x3, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/pool.go:76 +0x4c8\n\
github.com/concourse/atc/resource.(*tracker).Init(0xc208150290, 0xc2084b2e40, 0x1c, 0x0, 0x0, 0x6f6, 0x9ad610, 0x3, 0x3, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/tracker.go:46 +0x425\n\
github.com/concourse/atc/exec.(*resourceStep).Run(0xc208068d00, 0xc208546c00, 0xc208546cc0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/resource_step.go:45 +0xb9\n\
github.com/concourse/atc/exec.failureReporter.Run(0x7f259c994018, 0xc208068d00, 0xc2084b3720, 0xc208546c00, 0xc208546cc0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/garden_factory.go:148 +0x61\n\
github.com/concourse/atc/exec.(*failureReporter).Run(0xc2084b3740, 0xc208546c00, 0xc208546cc0, 0x0, 0x0)\n\
	<autogenerated>:56 +0xc7\n\
github.com/tedsuo/ifrit.(*process).run(0xc208398640)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 50876 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 33735 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc20857c360, 0xc20857c420, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2083fb9e0, 0xc20857c360, 0xc20857c420, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2083fba40, 0xc20857c360, 0xc20857c420, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2082b1280)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 78582 [select, 1166 minutes]:\n\
net/http.(*persistConn).writeLoop(0xc2082a2fd0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:945 +0x41d\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:661 +0xcbc\n\
\n\
goroutine 50881 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 77218 [chan receive, 1168 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 38133 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc208282780, 0xc2082827e0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2084b7a40, 0xc208282780, 0xc2082827e0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2084b7c80, 0xc208282780, 0xc2082827e0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208399500)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 38137 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc208282a80, 0xc208282ae0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2084b7b20, 0xc208282a80, 0xc208282ae0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2084b7ce0, 0xc208282a80, 0xc208282ae0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2083995c0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 77128 [select]:\n\
github.com/concourse/atc/worker.(*gardenWorkerContainer).heartbeat(0xc208430af0, 0x7f259c96df20, 0xc20830e2b8)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:236 +0x321\n\
created by github.com/concourse/atc/worker.newGardenWorkerContainer\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:211 +0x1f8\n\
\n\
goroutine 50863 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2082bfc20, 0x2f, 0x7f259c96dc18, 0xc2082f8ac0, 0x7f259c96dce0, 0xc208774080, 0xc208287320, 0xc208287380)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 73157 [semacquire, 1173 minutes]:\n\
sync.(*Cond).Wait(0xc20853c180)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*process).Wait(0xc20853c200, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/process.go:35 +0x7f\n\
github.com/concourse/atc/worker.(*retryableProcess).Wait(0xc208734fe0, 0x4, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:425 +0x5f\n\
github.com/concourse/atc/exec.func·004()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/task_step.go:168 +0x5f\n\
created by github.com/concourse/atc/exec.(*taskStep).Run\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/task_step.go:174 +0x808\n\
\n\
goroutine 38143 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 77143 [chan receive, 1168 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 54180 [IO wait, 1195 minutes]:\n\
net.(*pollDesc).Wait(0xc2084d92c0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc2084d92c0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2084d9260, 0xc208266000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20833e1c0)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e698, 0xc208266000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2082a5740)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc2082a5740, 0xc2083fcc01, 0x5ff, 0x5ff, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
encoding/json.(*Decoder).readValue(0xc208144600, 0xc207e9b3cf, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:124 +0x5e1\n\
encoding/json.(*Decoder).Decode(0xc208144600, 0x7ea140, 0xc20964c300, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:44 +0x7b\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).wait(0xc20930bec0, 0xc208144600, 0x5dfef1, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:53 +0x97\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·002()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:278 +0x125\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*connection).streamProcess\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:280 +0xc9c\n\
\n\
goroutine 88728 [select, 1153 minutes]:\n\
github.com/tedsuo/ifrit.func·002()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:92 +0xeb\n\
created by github.com/tedsuo/ifrit.(*process).Signal\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:96 +0xd6\n\
\n\
goroutine 147190 [semacquire, 1089 minutes]:\n\
sync.(*Cond).Wait(0xc2091f6d80)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*process).Wait(0xc2091f6dc0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/process.go:35 +0x7f\n\
github.com/concourse/atc/worker.(*retryableProcess).Wait(0xc2083baa20, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:425 +0x5f\n\
github.com/concourse/atc/api/hijackserver.func·002()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/api/hijackserver/hijack.go:162 +0x4b\n\
created by github.com/concourse/atc/api/hijackserver.(*Server).hijack\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/api/hijackserver/hijack.go:168 +0xfc7\n\
\n\
goroutine 73153 [IO wait, 1173 minutes]:\n\
net.(*pollDesc).Wait(0xc20829b720, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20829b720, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20829b6c0, 0xc20834f000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2087368a8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b57908, 0xc20834f000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2083a8f00)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc2083a8f00, 0xc208575201, 0x5ff, 0x5ff, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
encoding/json.(*Decoder).readValue(0xc2082dde00, 0xc207fac38b, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:124 +0x5e1\n\
encoding/json.(*Decoder).Decode(0xc2082dde00, 0x7ea140, 0xc20853c740, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:44 +0x7b\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).wait(0xc208734dc0, 0xc2082dde00, 0x4, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:53 +0x97\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·002()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:278 +0x125\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*connection).streamProcess\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:280 +0xc9c\n\
\n\
goroutine 50880 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 772126 [select, 3 minutes]:\n\
github.com/concourse/atc/engine.func·001()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/engine/db_engine.go:220 +0x20b\n\
created by github.com/concourse/atc/engine.(*dbBuild).Resume\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/engine/db_engine.go:230 +0xb9d\n\
\n\
goroutine 763556 [IO wait]:\n\
net.(*pollDesc).Wait(0xc208753a30, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208753a30, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2087539d0, 0xc208290000, 0x8000, 0x8000, 0x0, 0x7f259c96adf0, 0xc2086b2390)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20860c148, 0xc208290000, 0x8000, 0x8000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
io.Copy(0x7f259c982c80, 0xc20860c0f8, 0x7f259c96cf18, 0xc20860c148, 0x1b72b, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:362 +0x1f6\n\
net/http.func·008()\n\
	/var/vcap/packages/golang/src/net/http/server.go:171 +0x7d\n\
created by net/http.(*conn).closeNotify\n\
	/var/vcap/packages/golang/src/net/http/server.go:177 +0x2e2\n\
\n\
goroutine 73129 [IO wait, 1173 minutes]:\n\
net.(*pollDesc).Wait(0xc20829ba30, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20829ba30, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20829b9d0, 0xc2081db000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2092ff768)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b56270, 0xc2081db000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc20873dda0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc20873dda0, 0x7f259c994190, 0xc20857a5a0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:439 +0x1f0\n\
io.Copy(0x7f259c994190, 0xc20857a5a0, 0x7f259c96cf40, 0xc20873dda0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 78008 [IO wait, 1167 minutes]:\n\
net.(*pollDesc).Wait(0xc208753330, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208753330, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2087532d0, 0xc2087cd000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208731c78)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830ea00, 0xc2087cd000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.noteEOFReader.Read(0x7f259c96cf18, 0xc20830ea00, 0xc208395f48, 0xc2087cd000, 0x1000, 0x1000, 0x7f259c959010, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1270 +0x6e\n\
net/http.(*noteEOFReader).Read(0xc2084d72e0, 0xc2087cd000, 0x1000, 0x1000, 0xc207fcf15f, 0x0, 0x0)\n\
	<autogenerated>:125 +0xd4\n\
bufio.(*Reader).fill(0xc208406060)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Peek(0xc208406060, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:132 +0xf0\n\
net/http.(*persistConn).readLoop(0xc208395ef0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:842 +0xa4\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:660 +0xc9f\n\
\n\
goroutine 50869 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc208427c80, 0x32, 0x7f259c96dc18, 0xc2082f8be0, 0x7f259c96dce0, 0xc208774140, 0xc208287320, 0xc208287380)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 50859 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2082f89a0, 0x1b, 0x7f259c96dc18, 0xc2082f8a00, 0x7f259c96dce0, 0xc2087741c0, 0xc208287320, 0xc208287380)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 78591 [select, 1166 minutes]:\n\
net/http.(*persistConn).writeLoop(0xc2082a36b0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:945 +0x41d\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:661 +0xcbc\n\
\n\
goroutine 50864 [select, 1166 minutes]:\n\
net/http.(*persistConn).roundTrip(0xc2082a36b0, 0xc20845f6f0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1082 +0x7ad\n\
net/http.(*Transport).RoundTrip(0xc20857ae10, 0xc2084a20d0, 0xc20930b2e0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:235 +0x558\n\
net/http.send(0xc2084a20d0, 0x7f259c96afc0, 0xc20857ae10, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:219 +0x4fc\n\
net/http.(*Client).send(0xc2083a0870, 0xc2084a20d0, 0x15, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:142 +0x15b\n\
net/http.(*Client).doFollowingRedirects(0xc2083a0870, 0xc2084a20d0, 0xae1150, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:367 +0xb25\n\
net/http.(*Client).Do(0xc2083a0870, 0xc2084a20d0, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/client.go:177 +0x192\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*hijackable).Stream(0xc20930ae00, 0x99cb90, 0x6, 0x7f259c9842e0, 0xc20878ad20, 0x0, 0x0, 0x9ff110, 0x10, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection_hijacker.go:97 +0x1cb\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).do(0xc20930ae20, 0x99cb90, 0x6, 0x960c60, 0xc2082f5e00, 0x7fb720, 0xc20845f590, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:636 +0x1ea\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*connection).Create(0xc20930ae20, 0x0, 0x0, 0x0, 0xc20930a0c0, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:126 +0x12c\n\
github.com/concourse/atc/worker.func·007(0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:121 +0x94\n\
github.com/concourse/atc/worker.(*RetryableConnection).retry(0xc2092e0440, 0xc2084c31b0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:362 +0x105\n\
github.com/concourse/atc/worker.RetryableConnection.Create(0x7f259c983d38, 0xc20930ae20, 0x7f259c96bc08, 0xc2092baf60, 0x7f259c983e38, 0xc91bf8, 0x7f259c983e60, 0xc20845ef88, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:123 +0xe5\n\
github.com/concourse/atc/worker.(*RetryableConnection).Create(0xc2092e0100, 0x0, 0x0, 0x0, 0xc20930a0c0, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	<autogenerated>:50 +0xf9\n\
github.com/cloudfoundry-incubator/garden/client.(*client).Create(0xc20845efe0, 0x0, 0x0, 0x0, 0xc20930a0c0, 0x1e, 0x0, 0x0, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/client.go:31 +0x9d\n\
github.com/concourse/atc/worker.(*gardenWorker).CreateContainer(0xc20878aa80, 0xc2092a7a70, 0x24, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc2092cba26, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:96 +0x335\n\
github.com/concourse/atc/worker.(*Pool).CreateContainer(0xc20801fa80, 0xc2092a7a70, 0x24, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc2092cba26, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/pool.go:76 +0x4c8\n\
github.com/concourse/atc/resource.(*tracker).Init(0xc208150290, 0xc2092a7a70, 0x24, 0xc208827320, 0xe, 0x0, 0x9a94d0, 0x5, 0x0, 0xc2092cba26, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/tracker.go:46 +0x425\n\
github.com/concourse/atc/radar.(*Radar).scan(0xc2083e2690, 0x7f259c96bc08, 0xc208407560, 0xc2082dfda0, 0x24, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:148 +0x66d\n\
github.com/concourse/atc/radar.func·001(0xc208287c80, 0xc208287ce0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:88 +0x3ce\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2082f8b20, 0xc208287c80, 0xc208287ce0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2082f8c80, 0xc208287c80, 0xc208287ce0, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2087740c0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 147185 [semacquire, 1009 minutes]:\n\
sync.(*Cond).Wait(0xc208858cf0)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
io.(*pipe).read(0xc208858cc0, 0xc20928e000, 0x8000, 0x8000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:52 +0x303\n\
io.(*PipeReader).Read(0xc20860c280, 0xc20928e000, 0x8000, 0x8000, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:134 +0x5b\n\
io.Copy(0x7f259c984630, 0xc2083ba7c0, 0x7f259c982be0, 0xc20860c280, 0x1fd, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:362 +0x1f6\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·004(0x7f259c984600, 0xc2083ba7c0, 0x7f259c982be0, 0xc20860c280, 0x7f259c96bc08, 0xc2093032c0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:34 +0x6a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamIn\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:39 +0x75\n\
\n\
goroutine 772958 [chan receive, 2 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50847 [select]:\n\
github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run(0xc2083e28c0, 0xc208286cc0, 0xc208286d20, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:67 +0xab7\n\
github.com/tedsuo/ifrit.(*process).run(0xc208334d80)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 78009 [select, 1167 minutes]:\n\
net/http.(*persistConn).writeLoop(0xc208395ef0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:945 +0x41d\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:661 +0xcbc\n\
\n\
goroutine 38288 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc208209860, 0x23, 0x7f259c96dc18, 0xc2083fae60, 0x7f259c96dce0, 0xc208427dc0, 0xc2083ee420, 0xc2083ee480)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 411718 [chan receive, 729 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 50865 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc208427b00, 0x33, 0x7f259c96dc18, 0xc2082f8b20, 0x7f259c96dce0, 0xc2087740c0, 0xc208287320, 0xc208287380)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 38134 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2084b79c0, 0x1a, 0x7f259c96dc18, 0xc2084b7a40, 0x7f259c96dce0, 0xc208399500, 0xc2081bb1a0, 0xc2081bb200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 772156 [select]:\n\
github.com/concourse/atc/worker.(*gardenWorkerContainer).heartbeat(0xc208b134a0, 0x7f259c96df20, 0xc20830e778)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:236 +0x321\n\
created by github.com/concourse/atc/worker.newGardenWorkerContainer\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:211 +0x1f8\n\
\n\
goroutine 38287 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc2083ee7e0, 0xc2083ee960, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc2083fae60, 0xc2083ee7e0, 0xc2083ee960, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc2083faea0, 0xc2083ee7e0, 0xc2083ee960, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc208427dc0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 772127 [select, 2 minutes]:\n\
github.com/concourse/atc/exec.(*timeout).Run(0xc2088def00, 0xc208570c00, 0xc208665740, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/timeout_step.go:54 +0x39b\n\
github.com/concourse/atc/exec.(*hookedCompose).Run(0xc20800c480, 0xc208570c00, 0xc208570c60, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/hooked_compose_step.go:105 +0x94e\n\
github.com/tedsuo/ifrit.(*process).run(0xc2091f70c0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 77142 [semacquire, 1168 minutes]:\n\
sync.(*Cond).Wait(0xc20964cd80)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*process).Wait(0xc20964cdc0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/process.go:35 +0x7f\n\
github.com/concourse/atc/worker.(*retryableProcess).Wait(0xc209160d80, 0x4, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/retryable_garden_connection.go:425 +0x5f\n\
github.com/concourse/atc/resource.func·003()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/run_script.go:134 +0x4b\n\
created by github.com/concourse/atc/resource.func·004\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/run_script.go:140 +0x84c\n\
\n\
goroutine 50846 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 78608 [select, 1166 minutes]:\n\
net/http.(*persistConn).writeLoop(0xc2080c1290)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:945 +0x41d\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:661 +0xcbc\n\
\n\
goroutine 38148 [chan receive, 1221 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 109906 [IO wait, 1100 minutes]:\n\
net.(*pollDesc).Wait(0xc208828ae0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208828ae0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208828a80, 0xc208276000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2088c8560)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b560c8, 0xc208276000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc2092ce5e8, 0xc208276000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc208320800, 0xc208276000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc20833cd20)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc20833cd20, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc20833cd20, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc2086e74a0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc2086e74a0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc20833cd20, 0xc2088172b0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc2092ce5a0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc2092ce5a0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 772125 [select, 3 minutes]:\n\
github.com/concourse/atc/db.(*conditionNotifier).watch(0xc2091f7000)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:1066 +0x216\n\
created by github.com/concourse/atc/db.newConditionNotifier\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:1022 +0x233\n\
\n\
goroutine 50867 [chan receive, 1198 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc208427bc0, 0x35, 0x7f259c96dc18, 0xc2082f8b80, 0x7f259c96dce0, 0xc208774100, 0xc208287320, 0xc208287380)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 78590 [IO wait, 1166 minutes]:\n\
net.(*pollDesc).Wait(0xc20878b020, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20878b020, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20878afc0, 0xc208405000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20845f780)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e758, 0xc208405000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.noteEOFReader.Read(0x7f259c96cf18, 0xc20830e758, 0xc2082a3708, 0xc208405000, 0x1000, 0x1000, 0x7f259c959010, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:1270 +0x6e\n\
net/http.(*noteEOFReader).Read(0xc20930b3a0, 0xc208405000, 0x1000, 0x1000, 0xc207fcf189, 0x0, 0x0)\n\
	<autogenerated>:125 +0xd4\n\
bufio.(*Reader).fill(0xc2092bbe60)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Peek(0xc2092bbe60, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:132 +0xf0\n\
net/http.(*persistConn).readLoop(0xc2082a36b0)\n\
	/var/vcap/packages/golang/src/net/http/transport.go:842 +0xa4\n\
created by net/http.(*Transport).dialConn\n\
	/var/vcap/packages/golang/src/net/http/transport.go:660 +0xc9f\n\
\n\
goroutine 77035 [select, 1168 minutes]:\n\
github.com/concourse/atc/resource.func·004(0xc208546780, 0xc2085467e0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/resource/run_script.go:142 +0xe8d\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc208430b90, 0xc208546780, 0xc2085467e0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/concourse/atc/resource.(*versionedSource).Run(0xc208430b40, 0xc208546780, 0xc2085467e0, 0x0, 0x0)\n\
	<autogenerated>:14 +0x7c\n\
github.com/concourse/atc/exec.(*resourceStep).Run(0xc208068b00, 0xc208546780, 0xc2085467e0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/resource_step.go:57 +0x2e3\n\
github.com/concourse/atc/exec.failureReporter.Run(0x7f259c994018, 0xc208068b00, 0xc2084b36e0, 0xc208546780, 0xc2085467e0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/garden_factory.go:148 +0x61\n\
github.com/concourse/atc/exec.(*failureReporter).Run(0xc2084b3700, 0xc208546780, 0xc2085467e0, 0x0, 0x0)\n\
	<autogenerated>:56 +0xc7\n\
github.com/tedsuo/ifrit.(*process).run(0xc208398600)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 77137 [IO wait, 1168 minutes]:\n\
net.(*pollDesc).Wait(0xc208752290, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208752290, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208752230, 0xc2084f3000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2084378a8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e598, 0xc2084f3000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc208407da0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc208407da0, 0x7f259c994190, 0xc2080cacf0, 0x21, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:449 +0x27e\n\
io.Copy(0x7f259c994190, 0xc2080cacf0, 0x7f259c96cf40, 0xc208407da0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 73151 [IO wait, 1168 minutes]:\n\
net.(*pollDesc).Wait(0xc20829bb10, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20829bb10, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20829bab0, 0xc2087d9000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2092ffbc8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b57928, 0xc2087d9000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2083a8f60)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc2083a8f60, 0x7f259c994190, 0xc20857a090, 0x135f9, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:449 +0x27e\n\
io.Copy(0x7f259c994190, 0xc20857a090, 0x7f259c96cf40, 0xc2083a8f60, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 77217 [chan receive, 1168 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc209328b10, 0x30, 0x7f259c96dc18, 0xc2082f9480, 0x7f259c96dce0, 0xc2092e0240, 0xc2081bb1a0, 0xc2081bb200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 73130 [IO wait, 1173 minutes]:\n\
net.(*pollDesc).Wait(0xc20829b4f0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20829b4f0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20829b490, 0xc208815000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2092ff788)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b56240, 0xc208815000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc20873dce0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc20873dce0, 0xc208575801, 0x5ff, 0x5ff, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
encoding/json.(*Decoder).readValue(0xc20842d080, 0xc207fdfbb7, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:124 +0x5e1\n\
encoding/json.(*Decoder).Decode(0xc20842d080, 0x7ea140, 0xc208204480, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:44 +0x7b\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).wait(0xc2087edfe0, 0xc20842d080, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:53 +0x97\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·002()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:278 +0x125\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*connection).streamProcess\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:280 +0xc9c\n\
\n\
goroutine 147188 [IO wait, 1089 minutes]:\n\
net.(*pollDesc).Wait(0xc20879c610, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20879c610, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20879c5b0, 0xc208693000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2092fe3e8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20860c2c8, 0xc208693000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc209248960)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc209248960, 0xc2083fc601, 0x5ff, 0x5ff, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
encoding/json.(*Decoder).readValue(0xc209148f00, 0xc207ee08bf, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:124 +0x5e1\n\
encoding/json.(*Decoder).Decode(0xc209148f00, 0x7ea140, 0xc2091f7400, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:44 +0x7b\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).wait(0xc2083ba800, 0xc209148f00, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:53 +0x97\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·002()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:278 +0x125\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*connection).streamProcess\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:280 +0xc9c\n\
\n\
goroutine 73152 [IO wait, 1173 minutes]:\n\
net.(*pollDesc).Wait(0xc20829bf70, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20829bf70, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20829bf10, 0xc208521000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208736888)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b57938, 0xc208521000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2083a8fc0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc2083a8fc0, 0x7f259c994190, 0xc20857a120, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:439 +0x1f0\n\
io.Copy(0x7f259c994190, 0xc20857a120, 0x7f259c96cf40, 0xc2083a8fc0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 77031 [select, 1153 minutes]:\n\
github.com/concourse/atc/db.(*conditionNotifier).watch(0xc2083983c0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:1066 +0x216\n\
created by github.com/concourse/atc/db.newConditionNotifier\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:1022 +0x233\n\
\n\
goroutine 772215 [IO wait]:\n\
net.(*pollDesc).Wait(0xc2083b1410, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc2083b1410, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2083b13b0, 0xc208372000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2092d7310)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e0a8, 0xc208372000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc2092cef48, 0xc208372000, 0x1000, 0x1000, 0xc2084371d0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc208371220, 0xc208372000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc209302e40)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc209302e40, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc209302e40, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc2088714a0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc2088714a0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc209302e40, 0xc20942e000, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc2092cef00, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc2092cef00)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 725216 [IO wait, 94 minutes]:\n\
net.(*pollDesc).Wait(0xc20878b410, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20878b410, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20878b3b0, 0xc20881e000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc208b50680)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e0b8, 0xc20881e000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2088b5ec0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc2088b5ec0, 0xc2084d27a0, 0x5, 0x200, 0x8, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
io.ReadAtLeast(0x7f259c96cf40, 0xc2088b5ec0, 0xc2084d27a0, 0x5, 0x200, 0x5, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:298 +0xf1\n\
io.ReadFull(0x7f259c96cf40, 0xc2088b5ec0, 0xc2084d27a0, 0x5, 0x200, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:316 +0x6d\n\
github.com/lib/pq.(*conn).recvMessage(0xc2084d2780, 0xc209161760, 0x414d69, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:734 +0x17a\n\
github.com/lib/pq.(*conn).recv1Buf(0xc2084d2780, 0xc209161760, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:784 +0x32\n\
github.com/lib/pq.(*conn).recv1(0xc2084d2780, 0xc209161740, 0xc209161760)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:805 +0xa3\n\
github.com/lib/pq.(*stmt).exec(0xc2087523f0, 0xc208b50640, 0x1, 0x1)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:1166 +0xb27\n\
github.com/lib/pq.(*stmt).Exec(0xc2087523f0, 0xc208b50640, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:1110 +0x14d\n\
github.com/lib/pq.(*conn).Exec(0xc2084d2780, 0xc2094cee80, 0x3a, 0xc208b50640, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:676 +0x25a\n\
database/sql.(*Tx).Exec(0xc20832bae0, 0xc2094cee80, 0x3a, 0xc208b50540, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/database/sql/sql.go:1231 +0x261\n\
github.com/concourse/atc/db.(*SQLDB).acquireLock(0xc20801f940, 0x9a4a90, 0x6, 0xc208b50510, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:677 +0x8eb\n\
github.com/concourse/atc/db.(*SQLDB).acquireLockLoop(0xc20801f940, 0x9a4a90, 0x6, 0xc208b50510, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:699 +0x99\n\
github.com/concourse/atc/db.(*SQLDB).AcquireWriteLock(0xc20801f940, 0xc208b50510, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:711 +0x86\n\
github.com/concourse/atc/radar.(*Radar).Scan(0xc2084307d0, 0x7f259c96bc08, 0xc209248fc0, 0xc20881c320, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:101 +0x1dc\n\
github.com/concourse/atc/scheduler.(*Scheduler).scheduleAndResumePendingBuild(0xc208430820, 0x7f259c96bc08, 0xc2088b5680, 0x73e, 0xc2092ff528, 0x1, 0xc2092ff530, 0x7, 0x0, 0x26, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:209 +0x5e3\n\
github.com/concourse/atc/scheduler.func·002()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:177 +0x8e\n\
created by github.com/concourse/atc/scheduler.(*Scheduler).TriggerImmediately\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:182 +0x430\n\
\n\
goroutine 772957 [select, 2 minutes]:\n\
github.com/concourse/atc/exec.(*taskStep).Run(0xc208522ea0, 0xc2086657a0, 0xc208665980, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/task_step.go:176 +0xc95\n\
github.com/concourse/atc/exec.failureReporter.Run(0x7f259c7aabc0, 0xc208522ea0, 0xc2092682c0, 0xc2086657a0, 0xc208665980, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/exec/garden_factory.go:148 +0x61\n\
github.com/concourse/atc/exec.(*failureReporter).Run(0xc2092682e0, 0xc2086657a0, 0xc208665980, 0x0, 0x0)\n\
	<autogenerated>:56 +0xc7\n\
github.com/tedsuo/ifrit.(*process).run(0xc2088def40)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 411717 [chan receive, 729 minutes]:\n\
github.com/tedsuo/ifrit/grouper.waitForEvents(0xc2086f64c0, 0x34, 0x7f259c96dc18, 0xc20889a5c0, 0x7f259c96dce0, 0xc2086f6580, 0xc2081bb1a0, 0xc2081bb200)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:152 +0x1a6\n\
created by github.com/tedsuo/ifrit/grouper.(*dynamicGroup).Run\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/grouper/dynamic_group.go:105 +0x71b\n\
\n\
goroutine 770448 [IO wait, 4 minutes]:\n\
net.(*pollDesc).Wait(0xc20966fb80, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20966fb80, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20966fb20, 0xc209659000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc209201270)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e160, 0xc209659000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc208690ae8, 0xc209659000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc2092deac0, 0xc209659000, 0x1000, 0x1000, 0xc2092ce140, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc209251140)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc209251140, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc209251140, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc20828fc80, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc20828fc80, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc209251140, 0xc20942e270, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc208690aa0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc208690aa0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 773005 [IO wait, 2 minutes]:\n\
net.(*pollDesc).Wait(0xc20878a8b0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20878a8b0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20878a850, 0xc2092bc000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc209152850)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e298, 0xc2092bc000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2085715c0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc2085715c0, 0x7f259c994190, 0xc2080ca900, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:439 +0x1f0\n\
io.Copy(0x7f259c994190, 0xc2080ca900, 0x7f259c96cf40, 0xc2085715c0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 763033 [semacquire]:\n\
sync.(*Cond).Wait(0xc2082d61b0)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
io.(*pipe).read(0xc2082d6180, 0xc208277000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:52 +0x303\n\
io.(*PipeReader).Read(0xc20860c0f0, 0xc208277000, 0x1000, 0x1000, 0xa, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:134 +0x5b\n\
net/http.(*liveSwitchReader).Read(0xc2092ce408, 0xc208277000, 0x1000, 0x1000, 0xc209326a10, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc2081d9cc0, 0xc208277000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc208721860)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc208721860, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc208721860, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc2084f4ea0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc2084f4ea0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc208721860, 0xc208598000, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc2092ce3c0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc2092ce3c0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 772087 [select, 3 minutes]:\n\
github.com/concourse/atc/engine.(*execBuild).Resume(0xc2080ca120, 0x7f259c96bc08, 0xc20834cba0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/engine/exec_engine.go:113 +0x7cc\n\
github.com/concourse/atc/engine.(*dbBuild).Resume(0xc2092e01c0, 0x7f259c96bc08, 0xc20834cba0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/engine/db_engine.go:232 +0xbdc\n\
github.com/concourse/atc/scheduler.func·002()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:180 +0x13e\n\
created by github.com/concourse/atc/scheduler.(*Scheduler).TriggerImmediately\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:182 +0x430\n\
\n\
goroutine 705858 [IO wait]:\n\
net.(*pollDesc).Wait(0xc20856efb0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20856efb0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20856ef50, 0xc208404000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20841b570)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc208b56030, 0xc208404000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc2084fa4a8, 0xc208404000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc208783000, 0xc208404000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc2092bf200)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc2092bf200, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc2092bf200, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc20828fe60, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc20828fe60, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc2092bf200, 0xc2087c2dd0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc2084fa460, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc2084fa460)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 147159 [select, 1009 minutes]:\n\
github.com/concourse/atc/api/hijackserver.(*Server).hijack(0xc2081464e0, 0x7f259c96de70, 0xc2092ce820, 0xc20832aed7, 0x13, 0x0, 0x0, 0x710, 0x0, 0x0, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/api/hijackserver/hijack.go:171 +0x1545\n\
github.com/concourse/atc/api/hijackserver.(*Server).Hijack(0xc2081464e0, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/api/hijackserver/hijack.go:23 +0x11e\n\
github.com/concourse/atc/api/hijackserver.*Server.Hijack·fm(0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/api/handler.go:100 +0x45\n\
net/http.HandlerFunc.ServeHTTP(0xc208150310, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1265 +0x41\n\
github.com/concourse/atc/auth.Handler.ServeHTTP(0x7f259c96d528, 0xc20801faa0, 0x7f259c96b010, 0xc208150310, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/auth/handler.go:15 +0x88\n\
github.com/concourse/atc/auth.(*Handler).ServeHTTP(0xc20801fbe0, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	<autogenerated>:3 +0xbe\n\
github.com/bmizerany/pat.(*PatternServeMux).ServeHTTP(0xc20803a1d0, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/atc/src/github.com/bmizerany/pat/mux.go:109 +0x21c\n\
net/http.(*ServeMux).ServeHTTP(0xc2081a4720, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1541 +0x17d\n\
github.com/concourse/atc/auth.CookieSetHandler.ServeHTTP(0x7f259c96dab8, 0xc2081a4720, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/auth/cookie_set_handler.go:34 +0x2b8\n\
github.com/concourse/atc/auth.(*CookieSetHandler).ServeHTTP(0xc20818d1f0, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	<autogenerated>:1 +0xbd\n\
github.com/codahale/http-handlers/metrics.func·001(0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/atc/src/github.com/codahale/http-handlers/metrics/metrics.go:32 +0xf1\n\
net/http.HandlerFunc.ServeHTTP(0xc20818d210, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1265 +0x41\n\
net/http.serverHandler.ServeHTTP(0xc208047b00, 0x7f259c96de70, 0xc2092ce820, 0xc208b64340)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1703 +0x19a\n\
net/http.(*conn).serve(0xc2092ce780)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1204 +0xb57\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 147187 [IO wait, 1089 minutes]:\n\
net.(*pollDesc).Wait(0xc20879ca70, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20879ca70, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20879ca10, 0xc2088cb000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2092fe3d8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20860c300, 0xc2088cb000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc209248a80)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc209248a80, 0x7f25980e7660, 0xc20881dea0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:439 +0x1f0\n\
io.Copy(0x7f25980e7660, 0xc20881dea0, 0x7f259c96cf40, 0xc209248a80, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 767214 [IO wait]:\n\
net.(*pollDesc).Wait(0xc20966e6f0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20966e6f0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20966e690, 0xc2092d5000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc209152bb0)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20803a2e8, 0xc2092d5000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
net/http.(*liveSwitchReader).Read(0xc2092cea48, 0xc2092d5000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:214 +0xab\n\
io.(*LimitedReader).Read(0xc208b61d60, 0xc2092d5000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:408 +0xce\n\
bufio.(*Reader).fill(0xc2094be5a0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).ReadSlice(0xc2094be5a0, 0x7f259c96de0a, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:295 +0x257\n\
bufio.(*Reader).ReadLine(0xc2094be5a0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:324 +0x62\n\
net/textproto.(*Reader).readLineSlice(0xc208807230, 0x0, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:55 +0x9e\n\
net/textproto.(*Reader).ReadLine(0xc208807230, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/textproto/reader.go:36 +0x4f\n\
net/http.ReadRequest(0xc2094be5a0, 0xc20942fba0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/request.go:598 +0xcb\n\
net/http.(*conn).readRequest(0xc2092cea00, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/http/server.go:586 +0x26f\n\
net/http.(*conn).serve(0xc2092cea00)\n\
	/var/vcap/packages/golang/src/net/http/server.go:1162 +0x69e\n\
created by net/http.(*Server).Serve\n\
	/var/vcap/packages/golang/src/net/http/server.go:1751 +0x35e\n\
\n\
goroutine 411716 [select]:\n\
github.com/concourse/atc/radar.func·001(0xc2088b4ba0, 0xc2088b4c00, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:76 +0x458\n\
github.com/tedsuo/ifrit.RunFunc.Run(0xc20889a5c0, 0xc2088b4ba0, 0xc2088b4c00, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/runner.go:36 +0x49\n\
github.com/tedsuo/ifrit/grouper.(*Member).Run(0xc20889a620, 0xc2088b4ba0, 0xc2088b4c00, 0x0, 0x0)\n\
	<autogenerated>:1 +0x7d\n\
github.com/tedsuo/ifrit.(*process).run(0xc2086f6580)\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:71 +0x56\n\
created by github.com/tedsuo/ifrit.Background\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:49 +0x194\n\
\n\
goroutine 772992 [select]:\n\
github.com/concourse/atc/worker.(*gardenWorkerContainer).heartbeat(0xc208431130, 0x7f259c96df20, 0xc20830e280)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:236 +0x321\n\
created by github.com/concourse/atc/worker.newGardenWorkerContainer\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:211 +0x1f8\n\
\n\
goroutine 147186 [IO wait, 1009 minutes]:\n\
net.(*pollDesc).Wait(0xc20879c840, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20879c840, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20879c7e0, 0xc208810000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2088a5d88)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20860c2f0, 0xc208810000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2092489c0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).WriteTo(0xc2092489c0, 0x7f25980e7638, 0xc20881de90, 0x3021, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:449 +0x27e\n\
io.Copy(0x7f25980e7638, 0xc20881de90, 0x7f259c96cf40, 0xc2092489c0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:354 +0xb2\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·005()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:45 +0x4a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamOut\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:47 +0x142\n\
\n\
goroutine 147184 [select]:\n\
github.com/concourse/atc/worker.(*gardenWorkerContainer).heartbeat(0xc20832b400, 0x7f259c96df20, 0xc20860c250)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:236 +0x321\n\
created by github.com/concourse/atc/worker.newGardenWorkerContainer\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/worker/worker.go:211 +0x1f8\n\
\n\
goroutine 244059 [IO wait, 987 minutes]:\n\
net.(*pollDesc).Wait(0xc2081fb790, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc2081fb790, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc2081fb730, 0xc20972c000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc2095c7488)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20860d4d8, 0xc20972c000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2083eea80)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc2083eea80, 0xc2087e0f20, 0x5, 0x200, 0x8, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
io.ReadAtLeast(0x7f259c96cf40, 0xc2083eea80, 0xc2087e0f20, 0x5, 0x200, 0x5, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:298 +0xf1\n\
io.ReadFull(0x7f259c96cf40, 0xc2083eea80, 0xc2087e0f20, 0x5, 0x200, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:316 +0x6d\n\
github.com/lib/pq.(*conn).recvMessage(0xc2087e0f00, 0xc2085f32e0, 0x414d69, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:734 +0x17a\n\
github.com/lib/pq.(*conn).recv1Buf(0xc2087e0f00, 0xc2085f32e0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:784 +0x32\n\
github.com/lib/pq.(*conn).recv1(0xc2087e0f00, 0xc2085f32c0, 0xc2085f32e0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:805 +0xa3\n\
github.com/lib/pq.(*stmt).exec(0xc209624230, 0xc2095c7450, 0x1, 0x1)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:1166 +0xb27\n\
github.com/lib/pq.(*stmt).Exec(0xc209624230, 0xc2095c7450, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:1110 +0x14d\n\
github.com/lib/pq.(*conn).Exec(0xc2087e0f00, 0xc20828b800, 0x3a, 0xc2095c7450, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:676 +0x25a\n\
database/sql.(*Tx).Exec(0xc209590780, 0xc20828b800, 0x3a, 0xc2095c7340, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/database/sql/sql.go:1231 +0x261\n\
github.com/concourse/atc/db.(*SQLDB).acquireLock(0xc20801f940, 0x9a4a90, 0x6, 0xc2095c7310, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:677 +0x8eb\n\
github.com/concourse/atc/db.(*SQLDB).acquireLockLoop(0xc20801f940, 0x9a4a90, 0x6, 0xc2095c7310, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:699 +0x99\n\
github.com/concourse/atc/db.(*SQLDB).AcquireWriteLock(0xc20801f940, 0xc2095c7310, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:711 +0x86\n\
github.com/concourse/atc/radar.(*Radar).Scan(0xc2084cb9f0, 0x7f259c96bc08, 0xc208263620, 0xc20840d030, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:101 +0x1dc\n\
github.com/concourse/atc/scheduler.(*Scheduler).scheduleAndResumePendingBuild(0xc2084cba40, 0x7f259c96bc08, 0xc208262480, 0x72d, 0xc20827cf88, 0x1, 0xc20827cf90, 0x7, 0x0, 0x26, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:209 +0x5e3\n\
github.com/concourse/atc/scheduler.func·002()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:177 +0x8e\n\
created by github.com/concourse/atc/scheduler.(*Scheduler).TriggerImmediately\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:182 +0x430\n\
\n\
goroutine 757251 [semacquire, 21 minutes]:\n\
sync.(*Cond).Wait(0xc2088584b0)\n\
	/var/vcap/packages/golang/src/sync/cond.go:62 +0x9e\n\
io.(*pipe).read(0xc208858480, 0xc20914a000, 0x8000, 0x8000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:52 +0x303\n\
io.(*PipeReader).Read(0xc20860d050, 0xc20914a000, 0x8000, 0x8000, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/pipe.go:134 +0x5b\n\
io.Copy(0x7f259c984630, 0xc2086f1600, 0x7f259c982be0, 0xc20860d050, 0x3d, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:362 +0x1f6\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·004(0x7f259c984600, 0xc2086f1600, 0x7f259c982be0, 0xc20860d050, 0x7f259c96bc08, 0xc20873c600)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:34 +0x6a\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).streamIn\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:39 +0x75\n\
\n\
goroutine 772128 [chan receive, 3 minutes]:\n\
github.com/tedsuo/ifrit.func·001()\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:83 +0x51\n\
created by github.com/tedsuo/ifrit.(*process).Wait\n\
	/var/vcap/packages/atc/src/github.com/tedsuo/ifrit/process.go:85 +0xfb\n\
\n\
goroutine 773006 [IO wait, 2 minutes]:\n\
net.(*pollDesc).Wait(0xc208828370, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc208828370, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc208828310, 0xc2087cc000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc209152860)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20830e208, 0xc2087cc000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc208721920)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc208721920, 0xc2083fd801, 0x5ff, 0x5ff, 0x1, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
encoding/json.(*Decoder).readValue(0xc209149e00, 0xc207ee1a5f, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:124 +0x5e1\n\
encoding/json.(*Decoder).Decode(0xc209149e00, 0x7ea140, 0xc2091e5a00, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/encoding/json/stream.go:44 +0x7b\n\
github.com/cloudfoundry-incubator/garden/client/connection.(*streamHandler).wait(0xc208782520, 0xc209149e00, 0xc2081a4840, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/stream_handler.go:53 +0x97\n\
github.com/cloudfoundry-incubator/garden/client/connection.func·002()\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:278 +0x125\n\
created by github.com/cloudfoundry-incubator/garden/client/connection.(*connection).streamProcess\n\
	/var/vcap/packages/atc/src/github.com/cloudfoundry-incubator/garden/client/connection/connection.go:280 +0xc9c\n\
\n\
goroutine 244092 [IO wait, 987 minutes]:\n\
net.(*pollDesc).Wait(0xc20966efb0, 0x72, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:84 +0x47\n\
net.(*pollDesc).WaitRead(0xc20966efb0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/fd_poll_runtime.go:89 +0x43\n\
net.(*netFD).Read(0xc20966ef50, 0xc209658000, 0x1000, 0x1000, 0x0, 0x7f259c96adf0, 0xc20869d0a8)\n\
	/var/vcap/packages/golang/src/net/fd_unix.go:242 +0x40f\n\
net.(*conn).Read(0xc20860c510, 0xc209658000, 0x1000, 0x1000, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/net/net.go:121 +0xdc\n\
bufio.(*Reader).fill(0xc2088b5c80)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:97 +0x1ce\n\
bufio.(*Reader).Read(0xc2088b5c80, 0xc2084d31a0, 0x5, 0x200, 0x8, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/bufio/bufio.go:174 +0x26c\n\
io.ReadAtLeast(0x7f259c96cf40, 0xc2088b5c80, 0xc2084d31a0, 0x5, 0x200, 0x5, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:298 +0xf1\n\
io.ReadFull(0x7f259c96cf40, 0xc2088b5c80, 0xc2084d31a0, 0x5, 0x200, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/io/io.go:316 +0x6d\n\
github.com/lib/pq.(*conn).recvMessage(0xc2084d3180, 0xc2085c9920, 0x414d69, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:734 +0x17a\n\
github.com/lib/pq.(*conn).recv1Buf(0xc2084d3180, 0xc2085c9920, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:784 +0x32\n\
github.com/lib/pq.(*conn).recv1(0xc2084d3180, 0xc2085c9900, 0xc2085c9920)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:805 +0xa3\n\
github.com/lib/pq.(*stmt).exec(0xc209624cb0, 0xc20869d070, 0x1, 0x1)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:1166 +0xb27\n\
github.com/lib/pq.(*stmt).Exec(0xc209624cb0, 0xc20869d070, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:1110 +0x14d\n\
github.com/lib/pq.(*conn).Exec(0xc2084d3180, 0xc209565300, 0x3a, 0xc20869d070, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/lib/pq/conn.go:676 +0x25a\n\
database/sql.(*Tx).Exec(0xc208879d60, 0xc209565300, 0x3a, 0xc20869cf70, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/golang/src/database/sql/sql.go:1231 +0x261\n\
github.com/concourse/atc/db.(*SQLDB).acquireLock(0xc20801f940, 0x9a4a90, 0x6, 0xc20869cf40, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:677 +0x8eb\n\
github.com/concourse/atc/db.(*SQLDB).acquireLockLoop(0xc20801f940, 0x9a4a90, 0x6, 0xc20869cf40, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:699 +0x99\n\
github.com/concourse/atc/db.(*SQLDB).AcquireWriteLock(0xc20801f940, 0xc20869cf40, 0x1, 0x1, 0x0, 0x0, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/db/sqldb.go:711 +0x86\n\
github.com/concourse/atc/radar.(*Radar).Scan(0xc2083e26e0, 0x7f259c96bc08, 0xc209734420, 0xc2081405d0, 0xc, 0x0, 0x0)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/radar/radar.go:101 +0x1dc\n\
github.com/concourse/atc/scheduler.(*Scheduler).scheduleAndResumePendingBuild(0xc2083e2730, 0x7f259c96bc08, 0xc209734300, 0x72d, 0xc20869cc50, 0x1, 0xc20869cc54, 0x7, 0x1, 0x26, ...)\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:209 +0x5e3\n\
github.com/concourse/atc/scheduler.func·001()\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:154 +0x235\n\
created by github.com/concourse/atc/scheduler.(*Scheduler).TryNextPendingBuild\n\
	/var/vcap/packages/atc/src/github.com/concourse/atc/scheduler/scheduler.go:162 +0x2ae";

react();
