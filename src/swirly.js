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

GoroutineStack.prototype.matchesFilter = function(filter) {
  return this.stack.indexOf(filter) != -1 ||
    this.state.indexOf(filter) != -1 ||
    (this.waiting && this.waiting.indexOf(filter) != -1);
};

var callArgRegex = /\(((0x[a-f0-9]+|\.\.\.)(, )?)+\)/;
var locationRegex = /\t([^\s]+)( .*)?$/;

GoroutineStack.prototype.registerIn = function(group) {
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

var Goroutine = React.createClass({
  render: function() {
    var classes = ["goroutine"];
    if (this.props.data.waiting) {
      classes.push("waiting");
    }

    return (
        <div className={classes.join(" ")}>
          <div className="id">#{this.props.data.id}</div>
          <div className="status">{this.props.data.state}</div>
          <div className="waiting">{this.props.data.waiting}</div>
          <pre className="stack-trace">{this.props.data.stack}</pre>
        </div>
    );
  }
});

var boringRegex = /src\/([a-z]+)\//;
var StackGroup = React.createClass({
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
        subGroups.push(<StackGroup key={group.location.path} data={group} />);
      }

      for (var i in this.props.data.goroutines) {
        var goroutine = this.props.data.goroutines[i];
        goroutines.push(<Goroutine key={goroutine.id} data={goroutine} />);
      }
    }

    if (this.props.data.location.path === undefined) {
      return (
          <div className="root-group">
            {subGroups}
          </div>
      );
    }

    var classes = ["stack-group"];
    if (this.props.data.location.path.match(boringRegex)) {
      classes.push("boring");
    }

    return (
        <div className={classes.join(" ")}>
          <div className="title" onClick={this.handleToggle}>
            <h2>{this.props.data.packagePath()}</h2>
            <h1>{this.props.data.location.call}</h1>
          </div>
          <div className="stack-content">
            {goroutines}
            {subGroups}
          </div>
        </div>
    );
  }
});

var Root = React.createClass({
  getInitialState: function() {
    return {
      filter: "",
      goroutines: [],
    }
  },

  handleFilter: function(event) {
    this.setState({filter: event.target.value});
  },

  handleFetch: function(event) {
    var root = this;

    var url = React.findDOMNode(this.refs.url).value;

    $.ajax({
      url: url,
      success: function(response) {
        root.setState({goroutines: parseGoroutines(response)});
      }
    });

    event.preventDefault();
  },

  handleDump: function(event) {
    var dump = React.findDOMNode(this.refs.dump).value;
    this.setState({goroutines: parseGoroutines(dump)});

    // clear textarea; seems to kill performance if it keeps the data in there
    React.findDOMNode(this.refs.dump).value = "";

    event.preventDefault();
  },

  render: function() {
    var filteredGoroutines = [];
    for (var i in this.state.goroutines) {
      var goroutine = this.state.goroutines[i];
      if (goroutine.matchesFilter(this.state.filter)) {
        filteredGoroutines.push(goroutine);
      }
    }

    var rootGroup = goroutineGroups(filteredGoroutines);

    return (
        <div className="swirly">
          <div className="controls">
            <div className="filter">
              <input type="text" placeholder="filter..." onChange={this.handleFilter} />
            </div>

            <form className="fetch" onSubmit={this.handleFetch}>
              <input type="text" placeholder="url" ref="url" />
              <input type="submit" value="fetch" />
            </form>

            <form className="dump" onSubmit={this.handleDump}>
              <textarea rows="1" type="text" placeholder="dump" ref="dump" />
              <input type="submit" value="set" />
            </form>
          </div>

          <div className="goroutines">
            <StackGroup data={rootGroup} />
          </div>
        </div>
    );
  }
});

var goroutineHeaderRegex = /^goroutine (\d+) \[([^,\]]+)(, ([^,\]]+))?(, locked to thread)?\]:$/
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

React.render(
  <Root />,
  document.getElementById('dumps')
);
