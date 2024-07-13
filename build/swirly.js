function GoroutineGroup(location) {
  this.location = location;
  this.goroutines = [];
  this.groups = {};
}

var packagePathRegex = /.*src\//;
GoroutineGroup.prototype.packagePath = function () {
  return this.location.path.replace(packagePathRegex, "");
};

function GoroutineStack(id, state, waiting, isLocked) {
  this.id = id;
  this.state = state;
  this.waiting = waiting;
  this.isLocked = isLocked;
  this.stack = "";
}

GoroutineStack.prototype.pushStackLine = function (line) {
  this.stack += line + "\n";
};

GoroutineStack.prototype.matchesFilter = function (filter) {
  return (
    this.stack.indexOf(filter) != -1 ||
    this.state.indexOf(filter) != -1 ||
    (this.waiting && this.waiting.indexOf(filter) != -1)
  );
};

var callArgRegex = /\(((0x[a-f0-9]+|\.\.\.)(, )?)+\)/;
var locationRegex = /\s+([^\s]+)( .*)?$/;

GoroutineStack.prototype.registerIn = function (group) {
  var stackLines = this.stack.split("\n");
  if (stackLines[stackLines.length - 1] == "") {
    stackLines.pop();
  }

  var elidedIdx = stackLines.indexOf("...additional frames elided...");
  if (elidedIdx != -1) {
    stackLines.splice(elidedIdx, 1);
  }

  for (var i = stackLines.length - 2; i >= 0; i -= 2) {
    var call = stackLines[i];
    var path = stackLines[i + 1];

    var pathMatch = path.match(locationRegex);

    var location = {
      call: call.replace(callArgRegex, "()"),
      path: pathMatch[1],
    };

    if (!group.groups[location.path]) {
      group.groups[location.path] = new GoroutineGroup(location);
    }

    group = group.groups[location.path];
  }

  group.goroutines.push(this);
};

GoroutineStack.prototype.waitInSeconds = function () {
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

var Goroutine = React.createClass({
  displayName: "Goroutine",
  render: function () {
    var classes = ["goroutine"];
    if (this.props.data.waiting) {
      classes.push("waiting");
    }

    return React.createElement(
      "div",
      { className: classes.join(" ") },
      React.createElement("div", { className: "id" }, "#", this.props.data.id),
      React.createElement(
        "div",
        { className: "status" },
        this.props.data.state,
      ),
      React.createElement(
        "div",
        { className: "waiting" },
        this.props.data.waiting,
      ),
      React.createElement(
        "pre",
        { className: "stack-trace" },
        this.props.data.stack,
      ),
    );
  },
});

var boringRegex = /src\/([a-z]+)\//;
var StackGroup = React.createClass({
  displayName: "StackGroup",
  getInitialState: function () {
    return { expanded: true };
  },

  handleToggle: function () {
    this.setState({ expanded: !this.state.expanded });
  },

  render: function () {
    var subGroups = [];
    var goroutines = [];

    if (this.state.expanded) {
      for (var i in this.props.data.groups) {
        var group = this.props.data.groups[i];
        subGroups.push(
          React.createElement(StackGroup, {
            key: group.location.path,
            data: group,
          }),
        );
      }

      for (var i in this.props.data.goroutines) {
        var goroutine = this.props.data.goroutines[i];
        goroutines.push(
          React.createElement(Goroutine, {
            key: goroutine.id,
            data: goroutine,
          }),
        );
      }
    }

    if (this.props.data.location.path === undefined) {
      return React.createElement("div", { className: "root-group" }, subGroups);
    }

    var classes = ["stack-group"];
    if (this.props.data.location.path.match(boringRegex)) {
      classes.push("boring");
    }

    return React.createElement(
      "div",
      { className: classes.join(" ") },
      React.createElement(
        "div",
        { className: "title", onClick: this.handleToggle },
        React.createElement("h2", null, this.props.data.packagePath()),
        React.createElement("h1", null, this.props.data.location.call),
      ),
      React.createElement(
        "div",
        { className: "stack-content" },
        goroutines,
        subGroups,
      ),
    );
  },
});

var Root = React.createClass({
  displayName: "Root",
  getInitialState: function () {
    return {
      filter: "",
      goroutines: [],
    };
  },

  handleFilter: function (event) {
    this.setState({ filter: event.target.value });
  },

  handleFetch: function (event) {
    var root = this;

    var url = React.findDOMNode(this.refs.url).value;

    $.ajax({
      url: url,
      success: function (response) {
        root.setState({ goroutines: parseGoroutines(response) });
      },
    });

    event.preventDefault();
  },

  handleDump: function (event) {
    var dump = React.findDOMNode(this.refs.dump).value;
    this.setState({ goroutines: parseGoroutines(dump) });

    // clear textarea; seems to kill performance if it keeps the data in there
    React.findDOMNode(this.refs.dump).value = "";

    event.preventDefault();
  },

  render: function () {
    var filteredGoroutines = [];
    for (var i in this.state.goroutines) {
      var goroutine = this.state.goroutines[i];
      if (goroutine.matchesFilter(this.state.filter)) {
        filteredGoroutines.push(goroutine);
      }
    }

    var rootGroup = goroutineGroups(filteredGoroutines);

    return React.createElement(
      "div",
      { className: "swirly" },
      React.createElement(
        "div",
        { className: "controls" },
        React.createElement(
          "div",
          { className: "filter" },
          React.createElement("input", {
            type: "text",
            placeholder: "filter...",
            onChange: this.handleFilter,
          }),
        ),

        React.createElement(
          "form",
          { className: "fetch", onSubmit: this.handleFetch },
          React.createElement("input", {
            type: "text",
            placeholder: "url",
            ref: "url",
          }),
          React.createElement("input", { type: "submit", value: "fetch" }),
        ),

        React.createElement(
          "form",
          { className: "dump", onSubmit: this.handleDump },
          React.createElement("textarea", {
            rows: "1",
            type: "text",
            placeholder: "dump",
            ref: "dump",
          }),
          React.createElement("input", { type: "submit", value: "set" }),
        ),
      ),

      React.createElement(
        "div",
        { className: "goroutines" },
        React.createElement(StackGroup, { data: rootGroup }),
      ),
    );
  },
});

var goroutineHeaderRegex =
  /^goroutine (\d+) [^\[]*\[([^,\]]+)(, ([^,\]]+))?(, locked to thread)?\]:$/;
function parseGoroutines(dump) {
  var dumpLines = dump.split("\n");
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

React.render(React.createElement(Root, null), document.getElementById("dumps"));
