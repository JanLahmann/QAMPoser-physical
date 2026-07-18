OPENQASM 2.0;
include "qelib1.inc";

qreg q[5];
creg c[5];

h q[0];
x q[1];
y q[2];
z q[3];
rx(pi/2) q[0];
ry(pi/4) q[1];
rz(pi) q[2];
cx q[0], q[1];
rz(-pi/2) q[3];
